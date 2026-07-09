import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole, teamGuard } from '../middleware/rbac'

const router = Router()
router.use(requireAuth)

const ScheduleSchema = z.object({
  deviceId:   z.string().nullable().optional(),
  groupId:    z.string().nullable().optional(),
  playlistId: z.string(),
  startTime:  z.string().regex(/^\d{2}:\d{2}$/),
  endTime:    z.string().regex(/^\d{2}:\d{2}$/),
  daysOfWeek: z.array(z.number().min(0).max(6)),
  priority:   z.number().default(0),
  isActive:   z.boolean().default(true),
})

// GET /api/schedules?deviceId=xxx
router.get('/', async (req: AuthRequest, res) => {
  const { deviceId, groupId } = req.query as Record<string, string>
  const teamId = req.user!.teamId || undefined

  const schedules = await prisma.schedule.findMany({
    where: {
      ...(deviceId ? { deviceId } : {}),
      ...(groupId  ? { groupId  } : {}),
      ...(teamId   ? { OR: [
          { device: { teamId } },
          { group:  { teamId } },
        ]} : {}),
    },
    include: {
      playlist: { select: { id: true, name: true } },
      device:   { select: { id: true, name: true } },
      group:    { select: { id: true, name: true } },
    },
    orderBy: [{ priority: 'desc' }, { startTime: 'asc' }],
  })
  res.json(schedules)
})

// POST /api/schedules
router.post('/', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const body = ScheduleSchema.safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })
  if (!body.data.deviceId && !body.data.groupId)
    return res.status(400).json({ error: 'deviceId or groupId required' })

  const playlist = await prisma.playlist.findUnique({ where: { id: body.data.playlistId } })
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })

  const targetTeamId = playlist.teamId

  // Enforce team boundary for non-super-admins
  if (req.user!.role !== 'SUPER_ADMIN' && targetTeamId !== req.user!.teamId) {
    return res.status(403).json({ error: 'Playlist not found or access denied' })
  }

  if (body.data.deviceId) {
    const device = await prisma.device.findUnique({ where: { id: body.data.deviceId } })
    if (!device) return res.status(404).json({ error: 'Device not found' })
    if (device.teamId !== targetTeamId) {
      return res.status(400).json({ error: 'Device and playlist must belong to the same organization' })
    }
    if (req.user!.role !== 'SUPER_ADMIN' && device.teamId !== req.user!.teamId) {
      return res.status(403).json({ error: 'Device not found or access denied' })
    }
  }

  if (body.data.groupId) {
    const group = await prisma.deviceGroup.findUnique({ where: { id: body.data.groupId } })
    if (!group) return res.status(404).json({ error: 'Device group not found' })
    if (group.teamId !== targetTeamId) {
      return res.status(400).json({ error: 'Device group and playlist must belong to the same organization' })
    }
    if (req.user!.role !== 'SUPER_ADMIN' && group.teamId !== req.user!.teamId) {
      return res.status(403).json({ error: 'Device group not found or access denied' })
    }
  }

  const schedule = await prisma.schedule.create({ data: body.data })
  res.json(schedule)
})

// PATCH /api/schedules/:id
router.patch('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const existing = await prisma.schedule.findUnique({
    where: { id: req.params.id },
    include: { device: true, group: true, playlist: true },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const currentTeamId = existing.device?.teamId || existing.group?.teamId || existing.playlist.teamId
  if (req.user!.role !== 'SUPER_ADMIN' && currentTeamId !== req.user!.teamId) {
    return res.status(403).json({ error: 'Access denied' })
  }

  const body = ScheduleSchema.partial().safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  const targetPlaylistId = body.data.playlistId || existing.playlistId
  const targetDeviceId = body.data.deviceId !== undefined ? body.data.deviceId : existing.deviceId
  const targetGroupId = body.data.groupId !== undefined ? body.data.groupId : existing.groupId

  const playlist = await prisma.playlist.findUnique({ where: { id: targetPlaylistId } })
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })

  const targetTeamId = playlist.teamId

  if (req.user!.role !== 'SUPER_ADMIN' && targetTeamId !== req.user!.teamId) {
    return res.status(403).json({ error: 'Playlist not found or access denied' })
  }

  if (targetDeviceId) {
    const device = await prisma.device.findUnique({ where: { id: targetDeviceId } })
    if (!device) return res.status(404).json({ error: 'Device not found' })
    if (device.teamId !== targetTeamId) {
      return res.status(400).json({ error: 'Device and playlist must belong to the same organization' })
    }
    if (req.user!.role !== 'SUPER_ADMIN' && device.teamId !== req.user!.teamId) {
      return res.status(403).json({ error: 'Device not found or access denied' })
    }
  }

  if (targetGroupId) {
    const group = await prisma.deviceGroup.findUnique({ where: { id: targetGroupId } })
    if (!group) return res.status(404).json({ error: 'Device group not found' })
    if (group.teamId !== targetTeamId) {
      return res.status(400).json({ error: 'Device group and playlist must belong to the same organization' })
    }
    if (req.user!.role !== 'SUPER_ADMIN' && group.teamId !== req.user!.teamId) {
      return res.status(403).json({ error: 'Device group not found or access denied' })
    }
  }

  const updated = await prisma.schedule.update({ where: { id: existing.id }, data: body.data })
  res.json(updated)
})

// DELETE /api/schedules/:id
router.delete('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const existing = await prisma.schedule.findUnique({
    where: { id: req.params.id },
    include: { device: true, group: true, playlist: true },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const teamId = existing.device?.teamId || existing.group?.teamId || existing.playlist.teamId
  if (req.user!.role !== 'SUPER_ADMIN' && teamId !== req.user!.teamId) {
    return res.status(403).json({ error: 'Access denied' })
  }

  await prisma.schedule.delete({ where: { id: existing.id } })
  res.json({ ok: true })
})

export default router
