import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

function signTokens(user: { id: string; role: string; teamId: string | null }) {
  const access = jwt.sign(
    { sub: user.id, role: user.role, teamId: user.teamId },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  )
  const refresh = jwt.sign(
    { sub: user.id },
    process.env.REFRESH_SECRET!,
    { expiresIn: '30d' }
  )
  return { access, refresh }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string() }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'Invalid input' })

  const user = await prisma.user.findUnique({
    where: { email: body.data.email.toLowerCase() },
    include: {
      team: {
        select: {
          name: true,
          logoPath: true,
          splashPath: true,
          isPremium: true,
          maxStorage: true,
        }
      }
    }
  })
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })

  const ok = await bcrypt.compare(body.data.password, user.passwordHash)
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

  const tokens = signTokens(user)
  res.json({
    ...tokens,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      teamId: user.teamId,
      team: user.team
    },
  })
})

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    companyName: z.string().min(2)
  })
  
  const body = schema.safeParse(req.body)
  if (!body.success) {
    return res.status(400).json({ error: 'Invalid input data' })
  }

  const { name, email, password, companyName } = body.data
  const emailLower = email.toLowerCase()

  try {
    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: emailLower }
    })
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' })
    }

    // Create team and user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          name: companyName,
          isPremium: false, // Default to Free tier
          maxStorage: 5 * 1024 * 1024 * 1024 // 5 GB default
        }
      })

      const passwordHash = await bcrypt.hash(password, 10)

      const user = await tx.user.create({
        data: {
          name,
          email: emailLower,
          passwordHash,
          role: 'TEAM_ADMIN', // First user of the team is the Team Admin
          teamId: team.id
        },
        include: {
          team: {
            select: {
              name: true,
              logoPath: true,
              splashPath: true,
              isPremium: true,
              maxStorage: true
            }
          }
        }
      })

      return user
    })

    const tokens = signTokens(result)
    res.status(201).json({
      ...tokens,
      user: {
        id: result.id,
        name: result.name,
        email: result.email,
        role: result.role,
        teamId: result.teamId,
        team: result.team
      }
    })
  } catch (err: any) {
    console.error('Registration failed:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'Missing token' })
  try {
    const payload = jwt.verify(token, process.env.REFRESH_SECRET!) as any
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) return res.status(401).json({ error: 'User not found' })
    res.json(signTokens(user))
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' })
  }
})

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      teamId: true,
    },
  })
  if (!user) return res.status(404).json({ error: 'User not found' })

  const teamIdToFetch = req.user!.teamId || user.teamId
  let team = null
  if (teamIdToFetch) {
    const teamRecord = await prisma.team.findUnique({
      where: { id: teamIdToFetch },
      select: {
        id: true,
        name: true,
        logoPath: true,
        splashPath: true,
        isPremium: true,
        maxStorage: true,
        maxDevices: true,
        maxIngressMonthly: true,
        maxEgressMonthly: true,
        currentIngressMonthly: true,
        currentEgressMonthly: true,
        billingCycleAnchor: true,
        createdAt: true,
      }
    })
    if (teamRecord) {
      const storageSum = await prisma.content.aggregate({
        where: { teamId: teamIdToFetch },
        _sum: { fileSize: true }
      })
      const storageUsed = storageSum._sum.fileSize || 0

      const devicesCount = await prisma.device.count({
        where: { teamId: teamIdToFetch }
      })

      team = {
        ...teamRecord,
        storageUsed,
        devicesCount,
      }
    }
  }

  res.json({ ...user, team })
})

// POST /api/auth/setup  — creates first SUPER_ADMIN (only works when no users exist)
router.post('/setup', async (req, res) => {
  const count = await prisma.user.count()
  if (count > 0) return res.status(403).json({ error: 'Setup already complete' })

  const body = z.object({ name: z.string(), email: z.string().email(), password: z.string().min(8) }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  const team = await prisma.team.create({ data: { name: `${body.data.name}'s Team` } })

  const user = await prisma.user.create({
    data: {
      name: body.data.name,
      email: body.data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(body.data.password, 12),
      role: 'SUPER_ADMIN',
      teamId: team.id,
    },
  })
  res.json(signTokens(user))
})

export default router

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { sendPasswordReset } = await import('../services/email')
  const crypto = await import('crypto')
  const body = z.object({ email: z.string().email() }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'Invalid email' })

  const user = await prisma.user.findUnique({ where: { email: body.data.email.toLowerCase() } })
  // Always respond with 200 to avoid email enumeration
  if (!user) return res.json({ ok: true })

  // Generate token, store hash
  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  // Invalidate any existing tokens for this user
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  await prisma.passwordReset.create({ data: { tokenHash, userId: user.id, expiresAt } })

  const proto = req.headers['x-forwarded-proto'] || req.protocol
  const host = req.get('host')
  const reqBaseUrl = `${proto}://${host}`
  const resetUrl = `${reqBaseUrl}/reset-password?token=${token}`
  await sendPasswordReset(user.email, user.name, resetUrl)

  res.json({ ok: true })
})

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const crypto = await import('crypto')
  const body = z.object({ token: z.string(), password: z.string().min(8) }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'Invalid input' })

  const tokenHash = crypto.createHash('sha256').update(body.data.token).digest('hex')
  const record = await prisma.passwordReset.findUnique({ where: { tokenHash } })

  if (!record || record.usedAt || record.expiresAt < new Date())
    return res.status(400).json({ error: 'Reset link is invalid or has expired' })

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await bcrypt.hash(body.data.password, 12) },
    }),
    prisma.passwordReset.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ])

  res.json({ ok: true })
})
