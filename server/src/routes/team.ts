import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { syncTeamSettings } from '../socket'

const router = Router()
router.use(requireAuth)

// GET /api/team — list all teams (SUPER_ADMIN only)
router.get('/', requireRole('SUPER_ADMIN'), async (req: AuthRequest, res) => {
  try {
    const teams = await prisma.team.findMany({
      orderBy: { name: 'asc' }
    })

    // Group by teamId to sum all content fileSizes in a single database query
    const storageSums = await prisma.content.groupBy({
      by: ['teamId'],
      _sum: {
        fileSize: true
      }
    })

    const storageMap = new Map(storageSums.map(s => [s.teamId, s._sum.fileSize || 0]))

    const teamsWithStorage = teams.map(team => ({
      ...team,
      storageUsed: storageMap.get(team.id) || 0
    }))

    res.json(teamsWithStorage)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// POST /api/team — create a new team/org (SUPER_ADMIN only)
router.post('/', requireRole('SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const { name, maxDevices } = req.body
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Organization name is required' })
  }

  try {
    const team = await prisma.team.create({
      data: { 
        name: name.trim(),
        ...(maxDevices !== undefined ? { maxDevices: Number(maxDevices) } : {})
      }
    })
    res.json(team)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

router.use(requireRole('TEAM_ADMIN', 'SUPER_ADMIN'))

const MEDIA_PATH = process.env.MEDIA_PATH || '/media'

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(MEDIA_PATH, 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req: AuthRequest | any, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const type = file.fieldname === 'logo' ? 'logo' : 'splash'
    cb(null, `team-${type}-${req.user!.teamId}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit for logos/splashes
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg']
    cb(null, allowed.includes(file.mimetype))
  }
})

// POST /api/team/settings
router.post('/settings', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'splash', maxCount: 1 }
]), async (req: AuthRequest, res) => {
  const teamId = req.user!.teamId
  if (!teamId) {
    return res.status(400).json({ error: 'User does not belong to a team' })
  }

  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined
    const team = await prisma.team.findUnique({ where: { id: teamId } })
    if (!team) return res.status(404).json({ error: 'Team not found' })

    let uploadBytes = 0
    if (files?.logo && files.logo[0]) uploadBytes += files.logo[0].size
    if (files?.splash && files.splash[0]) uploadBytes += files.splash[0].size

    if (uploadBytes > 0 && team.currentIngressMonthly + uploadBytes > team.maxIngressMonthly) {
      if (files?.logo && files.logo[0]) {
        try { fs.unlinkSync(files.logo[0].path) } catch {}
      }
      if (files?.splash && files.splash[0]) {
        try { fs.unlinkSync(files.splash[0].path) } catch {}
      }
      return res.status(402).json({ error: 'Monthly upload (ingress) limit exceeded for this organization.' })
    }

    const updateData: { logoPath?: string | null; splashPath?: string | null } = {}

    // Handle logo upload
    if (files?.logo && files.logo[0]) {
      const logoFile = files.logo[0]
      const relativePath = `uploads/${logoFile.filename}`

      // If old logo exists and has different path, delete it
      if (team.logoPath && team.logoPath !== relativePath) {
        const oldFullPath = path.join(MEDIA_PATH, team.logoPath)
        if (fs.existsSync(oldFullPath)) {
          try { fs.unlinkSync(oldFullPath) } catch (e) { console.error('Error deleting old logo:', e) }
        }
      }
      updateData.logoPath = relativePath
    }

    // Handle splash upload
    if (files?.splash && files.splash[0]) {
      const splashFile = files.splash[0]
      const relativePath = `uploads/${splashFile.filename}`

      // If old splash exists and has different path, delete it
      if (team.splashPath && team.splashPath !== relativePath) {
        const oldFullPath = path.join(MEDIA_PATH, team.splashPath)
        if (fs.existsSync(oldFullPath)) {
          try { fs.unlinkSync(oldFullPath) } catch (e) { console.error('Error deleting old splash:', e) }
        }
      }
      updateData.splashPath = relativePath
    }

    if (Object.keys(updateData).length > 0 || uploadBytes > 0) {
      const updatedTeam = await prisma.team.update({
        where: { id: teamId },
        data: {
          ...updateData,
          currentIngressMonthly: { increment: uploadBytes }
        }
      })

      // If splash changed, notify connected devices
      if (updateData.splashPath !== undefined) {
        await syncTeamSettings(teamId)
      }

      return res.json(updatedTeam)
    }

    res.json(team)
  } catch (err: any) {
    console.error('Error updating team settings:', err)
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// DELETE /api/team/settings/:type
router.delete('/settings/:type', async (req: AuthRequest, res) => {
  const teamId = req.user!.teamId
  if (!teamId) {
    return res.status(400).json({ error: 'User does not belong to a team' })
  }

  const { type } = req.params
  if (type !== 'logo' && type !== 'splash') {
    return res.status(400).json({ error: 'Invalid settings type' })
  }

  try {
    const team = await prisma.team.findUnique({ where: { id: teamId } })
    if (!team) return res.status(404).json({ error: 'Team not found' })

    const field = type === 'logo' ? 'logoPath' : 'splashPath'
    const currentPath = team[field]

    if (currentPath) {
      const fullPath = path.join(MEDIA_PATH, currentPath)
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath) } catch (e) { console.error(`Error deleting old ${type}:`, e) }
      }

      const updatedTeam = await prisma.team.update({
        where: { id: teamId },
        data: { [field]: null }
      })

      if (type === 'splash') {
        await syncTeamSettings(teamId)
      }

      return res.json(updatedTeam)
    }

    res.json(team)
  } catch (err: any) {
    console.error(`Error deleting team ${type}:`, err)
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// PATCH /api/team/:id - Update team details (SUPER_ADMIN only)
router.patch('/:id', requireRole('SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const { id } = req.params
  const { name, isPremium, maxStorage, maxDevices, maxIngressMonthly, maxEgressMonthly } = req.body

  try {
    const team = await prisma.team.findUnique({ where: { id } })
    if (!team) return res.status(404).json({ error: 'Organization not found' })

    const updated = await prisma.team.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(isPremium !== undefined ? { isPremium: Boolean(isPremium) } : {}),
        ...(maxStorage !== undefined ? { maxStorage: Number(maxStorage) } : {}),
        ...(maxDevices !== undefined ? { maxDevices: Number(maxDevices) } : {}),
        ...(maxIngressMonthly !== undefined ? { maxIngressMonthly: Number(maxIngressMonthly) } : {}),
        ...(maxEgressMonthly !== undefined ? { maxEgressMonthly: Number(maxEgressMonthly) } : {}),
      }
    })
    res.json(updated)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

export default router
