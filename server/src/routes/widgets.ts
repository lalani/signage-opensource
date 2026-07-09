import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole, teamGuard } from '../middleware/rbac'
import { pushDeviceSettings } from '../socket'

const router = Router()
router.use(requireAuth)

const POSITIONS = [
  'TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT',
  'TOP_CENTER', 'BOTTOM_CENTER', 'CENTER',
  'TOP_BAR', 'BOTTOM_BAR', 'LEFT_BAR', 'RIGHT_BAR', 'CUSTOM'
] as const

// GET /api/widgets — Get all widgets for the team
router.get('/', async (req: AuthRequest, res) => {
  try {
    let where: any = {}
    if (req.user!.teamId) {
      where.teamId = req.user!.teamId
    }

    const widgets = await prisma.widget.findMany({
      where,
      include: {
        devices: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    res.json(widgets)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// POST /api/widgets — Create a widget and optionally assign it to devices
router.post('/', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const schema = z.object({
    name: z.string().min(1),
    type: z.enum(['CLOCK', 'WEATHER', 'TICKER']),
    position: z.enum(POSITIONS),
    settings: z.string(), // JSON string
    deviceIds: z.array(z.string()).optional(),
    teamId: z.string().optional() // Super Admin only
  })

  const body = schema.safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  const targetTeamId = (req.user!.role === 'SUPER_ADMIN' && body.data.teamId)
    ? body.data.teamId
    : req.user!.teamId

  if (!targetTeamId) {
    return res.status(400).json({ error: 'User does not belong to an organization' })
  }

  try {
    // Validate that all devices belong to the target team
    if (body.data.deviceIds && body.data.deviceIds.length > 0) {
      const devicesCount = await prisma.device.count({
        where: {
          id: { in: body.data.deviceIds },
          teamId: targetTeamId
        }
      })
      if (devicesCount !== body.data.deviceIds.length) {
        return res.status(400).json({ error: 'Some assigned devices were not found or belong to a different organization' })
      }
    }

    // Validate settings JSON
    try {
      JSON.parse(body.data.settings)
    } catch {
      return res.status(400).json({ error: 'Invalid JSON string for settings' })
    }

    const widget = await prisma.widget.create({
      data: {
        name: body.data.name,
        type: body.data.type,
        position: body.data.position,
        settings: body.data.settings,
        teamId: targetTeamId,
        devices: {
          connect: (body.data.deviceIds || []).map(id => ({ id }))
        }
      },
      include: {
        devices: { select: { id: true, name: true } }
      }
    })

    // Push settings updates to newly assigned devices
    if (body.data.deviceIds && body.data.deviceIds.length > 0) {
      for (const devId of body.data.deviceIds) {
        await pushDeviceSettings(devId).catch(() => {})
      }
    }

    res.status(201).json(widget)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// PATCH /api/widgets/:id — Update a widget
router.patch('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const { id } = req.params
  const schema = z.object({
    name: z.string().min(1).optional(),
    position: z.enum(POSITIONS).optional(),
    settings: z.string().optional(),
    deviceIds: z.array(z.string()).optional()
  })

  const body = schema.safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  try {
    const widget = await prisma.widget.findUnique({
      where: { id },
      include: { devices: { select: { id: true } } }
    })
    if (!widget || !teamGuard(widget.teamId, req)) {
      return res.status(404).json({ error: 'Widget not found' })
    }

    if (body.data.settings) {
      try {
        JSON.parse(body.data.settings)
      } catch {
        return res.status(400).json({ error: 'Invalid JSON string for settings' })
      }
    }

    const updateData: Record<string, any> = {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.position !== undefined ? { position: body.data.position } : {}),
      ...(body.data.settings !== undefined ? { settings: body.data.settings } : {}),
    }

    if (body.data.deviceIds !== undefined) {
      // Validate that all devices belong to the widget's team
      const devicesCount = await prisma.device.count({
        where: {
          id: { in: body.data.deviceIds },
          teamId: widget.teamId
        }
      })
      if (devicesCount !== body.data.deviceIds.length) {
        return res.status(400).json({ error: 'Some assigned devices were not found or belong to a different organization' })
      }
      updateData.devices = {
        set: body.data.deviceIds.map(id => ({ id }))
      }
    }

    const updated = await prisma.widget.update({
      where: { id },
      data: updateData,
      include: {
        devices: { select: { id: true, name: true } }
      }
    })

    // Push settings updates to all old & new devices affected by the edit
    const oldDeviceIds = widget.devices.map(d => d.id)
    const newDeviceIds = updated.devices.map(d => d.id)
    const allAffected = Array.from(new Set([...oldDeviceIds, ...newDeviceIds]))
    for (const devId of allAffected) {
      await pushDeviceSettings(devId).catch(() => {})
    }

    res.json(updated)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// DELETE /api/widgets/:id — Delete a widget
router.delete('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const { id } = req.params
  try {
    const widget = await prisma.widget.findUnique({
      where: { id },
      include: { devices: { select: { id: true } } }
    })
    if (!widget || !teamGuard(widget.teamId, req)) {
      return res.status(404).json({ error: 'Widget not found' })
    }

    const affectedDeviceIds = widget.devices.map(d => d.id)

    await prisma.widget.delete({ where: { id } })

    // Push updates to affected devices so the deleted widget is cleared
    for (const devId of affectedDeviceIds) {
      await pushDeviceSettings(devId).catch(() => {})
    }

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

export default router
