import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole, teamGuard } from '../middleware/rbac'
import { sendCommand, buildPlaylistPayload } from '../socket'

const router = Router()
router.use(requireAuth)

// GET /api/groups
router.get('/', async (req: AuthRequest, res) => {
  try {
    const where: any = req.user!.teamId ? { teamId: req.user!.teamId } : {}
    const groups = await prisma.deviceGroup.findMany({
      where,
      include: {
        members: {
          include: {
            device: {
              select: {
                id: true,
                name: true,
                status: true,
                location: true,
                currentPlaylistId: true
              }
            }
          }
        },
        _count: { select: { schedules: true } }
      },
      orderBy: { name: 'asc' }
    })
    res.json(groups)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// GET /api/groups/:id
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const group = await prisma.deviceGroup.findUnique({
      where: { id: req.params.id },
      include: {
        members: {
          include: {
            device: true
          }
        }
      }
    })
    if (!group || !teamGuard(group.teamId, req)) {
      return res.status(404).json({ error: 'Device group not found' })
    }
    res.json(group)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// POST /api/groups
router.post('/', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const body = z.object({
    name: z.string().min(1),
    teamId: z.string().optional(),
    deviceIds: z.array(z.string()).optional()
  }).safeParse(req.body)

  if (!body.success) return res.status(400).json({ error: body.error.issues })

  let teamId = req.user!.teamId
  if (req.user!.role === 'SUPER_ADMIN' && body.data.teamId) {
    teamId = body.data.teamId
  }

  if (!teamId) {
    return res.status(400).json({ error: 'Active team/organization is required' })
  }

  try {
    // Verify all devices belong to the target team
    if (body.data.deviceIds && body.data.deviceIds.length > 0) {
      const devicesCount = await prisma.device.count({
        where: {
          id: { in: body.data.deviceIds },
          teamId
        }
      })
      if (devicesCount !== body.data.deviceIds.length) {
        return res.status(400).json({ error: 'One or more devices not found or belong to another organization' })
      }
    }

    const group = await prisma.deviceGroup.create({
      data: {
        name: body.data.name,
        teamId,
        members: {
          create: (body.data.deviceIds || []).map(deviceId => ({
            device: { connect: { id: deviceId } }
          }))
        }
      },
      include: {
        members: {
          include: { device: true }
        }
      }
    })
    res.json(group)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// PATCH /api/groups/:id
router.patch('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const group = await prisma.deviceGroup.findUnique({
    where: { id: req.params.id }
  })
  if (!group || !teamGuard(group.teamId, req)) {
    return res.status(404).json({ error: 'Device group not found' })
  }

  const body = z.object({
    name: z.string().min(1).optional(),
    deviceIds: z.array(z.string()).optional(),
    currentPlaylistId: z.string().nullable().optional()
  }).safeParse(req.body)

  if (!body.success) return res.status(400).json({ error: body.error.issues })

  try {
    // 1. Verify devices if passed
    if (body.data.deviceIds) {
      const devicesCount = await prisma.device.count({
        where: {
          id: { in: body.data.deviceIds },
          teamId: group.teamId
        }
      })
      if (devicesCount !== body.data.deviceIds.length) {
        return res.status(400).json({ error: 'One or more devices not found or belong to another organization' })
      }
    }

    // 2. Verify playlist if passed
    if (body.data.currentPlaylistId) {
      const playlist = await prisma.playlist.findUnique({
        where: { id: body.data.currentPlaylistId }
      })
      if (!playlist || playlist.teamId !== group.teamId) {
        return res.status(400).json({ error: 'Playlist not found or belongs to another organization' })
      }
    }

    // 3. Perform updates in transaction
    const updateOperations: any[] = []

    if (body.data.deviceIds !== undefined) {
      updateOperations.push(prisma.deviceGroupMember.deleteMany({ where: { groupId: group.id } }))
      if (body.data.deviceIds.length > 0) {
        updateOperations.push(
          prisma.deviceGroupMember.createMany({
            data: body.data.deviceIds.map(deviceId => ({
              groupId: group.id,
              deviceId
            }))
          })
        )
      }
    }

    const dataUpdate: any = {}
    if (body.data.name !== undefined) dataUpdate.name = body.data.name
    
    if (Object.keys(dataUpdate).length > 0) {
      updateOperations.push(
        prisma.deviceGroup.update({
          where: { id: group.id },
          data: dataUpdate
        })
      )
    }

    await prisma.$transaction(updateOperations)

    // 4. Handle immediate playlist deployment to group members
    if (body.data.currentPlaylistId !== undefined) {
      const members = await prisma.deviceGroupMember.findMany({
        where: { groupId: group.id },
        select: { deviceId: true }
      })
      const deviceIds = members.map(m => m.deviceId)

      if (deviceIds.length > 0) {
        await prisma.device.updateMany({
          where: { id: { in: deviceIds } },
          data: {
            currentPlaylistId: body.data.currentPlaylistId,
            manualPlaylistId: body.data.currentPlaylistId
          }
        })

        if (body.data.currentPlaylistId) {
          const playlist = await prisma.playlist.findUnique({
            where: { id: body.data.currentPlaylistId },
            include: {
              items: {
                include: {
                  content: {
                    include: {
                      slideImages: {
                        orderBy: { orderIndex: 'asc' }
                      }
                    }
                  }
                },
                orderBy: { orderIndex: 'asc' }
              }
            }
          })
          if (playlist) {
            for (const dId of deviceIds) {
              sendCommand(dId, 'cmd:play', (deviceBaseUrl: string) => buildPlaylistPayload(playlist, deviceBaseUrl))
            }
          }
        } else {
          for (const dId of deviceIds) {
            sendCommand(dId, 'cmd:clear', {})
          }
        }
      }
    }

    const updatedGroup = await prisma.deviceGroup.findUnique({
      where: { id: group.id },
      include: {
        members: {
          include: { device: true }
        }
      }
    })
    res.json(updatedGroup)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// DELETE /api/groups/:id
router.delete('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  try {
    const group = await prisma.deviceGroup.findUnique({
      where: { id: req.params.id }
    })
    if (!group || !teamGuard(group.teamId, req)) {
      return res.status(404).json({ error: 'Device group not found' })
    }

    await prisma.deviceGroup.delete({ where: { id: group.id } })
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

export default router
