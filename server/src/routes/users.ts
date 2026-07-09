import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'

const router = Router()
router.use(requireAuth)

// GET /api/users — list users (SUPER_ADMIN sees all, TEAM_ADMIN sees their team)
router.get('/', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const where = req.user!.teamId ? { teamId: req.user!.teamId } : {}

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, name: true, email: true, role: true, createdAt: true,
      team: { select: { id: true, name: true } },
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  })
  res.json(users)
})

// POST /api/users — create a new user
router.post('/', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const body = z.object({
    name:     z.string().min(1),
    email:    z.string().email(),
    password: z.string().min(8),
    role:     z.enum(['VIEWER', 'CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN']),
    teamId:   z.string().optional(),
  }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  // TEAM_ADMIN can only create users within their own team and can't create SUPER_ADMIN
  if (req.user!.role === 'TEAM_ADMIN') {
    if (body.data.role === 'SUPER_ADMIN')
      return res.status(403).json({ error: 'Cannot create SUPER_ADMIN' })
    if (body.data.teamId && body.data.teamId !== req.user!.teamId)
      return res.status(403).json({ error: 'Cannot create users in another team' })
  }

  const existing = await prisma.user.findUnique({ where: { email: body.data.email.toLowerCase() } })
  if (existing) return res.status(409).json({ error: 'Email already in use' })

  const user = await prisma.user.create({
    data: {
      name:         body.data.name,
      email:        body.data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(body.data.password, 12),
      role:         body.data.role,
      teamId:       body.data.teamId ?? req.user!.teamId,
    },
    select: { id: true, name: true, email: true, role: true, teamId: true, createdAt: true },
  })
  res.json(user)
})

// PATCH /api/users/:id — update role or team
router.patch('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!target) return res.status(404).json({ error: 'User not found' })

  // TEAM_ADMIN can only edit users in their own team
  if (req.user!.role === 'TEAM_ADMIN' && target.teamId !== req.user!.teamId)
    return res.status(403).json({ error: 'Cannot edit users in another team' })

  // Cannot demote or change yourself
  if (target.id === req.user!.id)
    return res.status(400).json({ error: 'Cannot edit your own account here' })

  const body = z.object({
    role:   z.enum(['VIEWER', 'CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN']).optional(),
    teamId: z.string().nullable().optional(),
    name:   z.string().min(1).optional(),
  }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  // Restrict teamId changes to SUPER_ADMIN
  if (body.data.teamId !== undefined && req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only Super Admins can move users to other organizations' })
  }

  if (req.user!.role === 'TEAM_ADMIN' && body.data.role === 'SUPER_ADMIN')
    return res.status(403).json({ error: 'Cannot assign SUPER_ADMIN role' })

  const updateData: Record<string, any> = {
    ...(body.data.role   !== undefined ? { role:   body.data.role }   : {}),
    ...(body.data.name   !== undefined ? { name:   body.data.name }   : {}),
  }

  if (body.data.teamId !== undefined) {
    updateData.teamId = body.data.teamId
    if (body.data.teamId !== target.teamId) {
      updateData.assignedDevices = { set: [] }
    }
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: updateData,
    select: { id: true, name: true, email: true, role: true, teamId: true },
  })
  res.json(updated)
})

// DELETE /api/users/:id
router.delete('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!target) return res.status(404).json({ error: 'User not found' })

  if (target.id === req.user!.id)
    return res.status(400).json({ error: 'Cannot delete your own account' })

  if (req.user!.role === 'TEAM_ADMIN' && target.teamId !== req.user!.teamId)
    return res.status(403).json({ error: 'Cannot delete users in another team' })

  await prisma.user.delete({ where: { id: target.id } })
  res.json({ ok: true })
})

export default router
