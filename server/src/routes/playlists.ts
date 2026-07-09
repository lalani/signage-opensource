import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole, teamGuard } from '../middleware/rbac'
import { sendCommand, buildPlaylistPayload } from '../socket'

const router = Router()
router.use(requireAuth)

// GET /api/playlists
router.get('/', async (req: AuthRequest, res) => {
  const where = req.user!.teamId ? { teamId: req.user!.teamId } : {}
  const playlists = await prisma.playlist.findMany({
    where,
    include: {
      creator: { select: { name: true } },
      _count: { select: { items: true, devices: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  res.json(playlists)
})

// GET /api/playlists/:id  — with full items
router.get('/:id', async (req: AuthRequest, res) => {
  const pl = await prisma.playlist.findUnique({
    where: { id: req.params.id },
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
        orderBy: { orderIndex: 'asc' },
      },
    },
  })
  if (!pl || !teamGuard(pl.teamId, req)) return res.status(404).json({ error: 'Not found' })
  res.json(pl)
})

// POST /api/playlists
router.post('/', requireRole('CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const body = z.object({
    name: z.string(),
    teamId: z.string().optional(),
  }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  let teamId = req.user!.teamId
  if (req.user!.role === 'SUPER_ADMIN' && body.data.teamId) {
    teamId = body.data.teamId
    const targetTeam = await prisma.team.findUnique({ where: { id: teamId } })
    if (!targetTeam) return res.status(400).json({ error: 'Target organization not found' })
  }

  if (!teamId) {
    return res.status(400).json({ error: 'Active team/organization is required for this action' })
  }

  const pl = await prisma.playlist.create({
    data: { name: body.data.name, teamId, createdBy: req.user!.id },
  })
  res.json(pl)
})

// PATCH /api/playlists/:id
router.patch('/:id', requireRole('CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const pl = await prisma.playlist.findUnique({ where: { id: req.params.id } })
  if (!pl || !teamGuard(pl.teamId, req)) return res.status(404).json({ error: 'Not found' })

  const body = z.object({ name: z.string().optional() }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  const updated = await prisma.playlist.update({ where: { id: pl.id }, data: body.data })
  res.json(updated)
})

// DELETE /api/playlists/:id
router.delete('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const pl = await prisma.playlist.findUnique({ where: { id: req.params.id } })
  if (!pl || !teamGuard(pl.teamId, req)) return res.status(404).json({ error: 'Not found' })
  // Clear manual assignment on any devices pointing to this playlist
  await prisma.device.updateMany({
    where: { manualPlaylistId: pl.id },
    data:  { manualPlaylistId: null },
  })
  await prisma.playlist.delete({ where: { id: pl.id } })
  res.json({ ok: true })
})

// PUT /api/playlists/:id/items — replace entire item list (used after DnD reorder)
router.put('/:id/items', requireRole('CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const pl = await prisma.playlist.findUnique({ where: { id: req.params.id } })
  if (!pl || !teamGuard(pl.teamId, req)) return res.status(404).json({ error: 'Not found' })

  const body = z.object({
    items: z.array(z.object({
      contentId: z.string(),
      durationSec: z.number().min(1).max(3600),
      crossfade: z.boolean().default(true),
    })),
  }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  // Verify that all content items belong to the same team as the playlist
  const contentIds = body.data.items.map((item) => item.contentId)
  const uniqueContentIds = [...new Set(contentIds)]
  const contentCount = await prisma.content.count({
    where: {
      id: { in: uniqueContentIds },
      teamId: pl.teamId,
    },
  })
  if (contentCount !== uniqueContentIds.length) {
    return res.status(403).json({ error: 'One or more content items do not belong to the playlist\'s organization' })
  }

  // Rebuild items in a transaction
  await prisma.$transaction([
    prisma.playlistItem.deleteMany({ where: { playlistId: pl.id } }),
    ...body.data.items.map((item, i) =>
      prisma.playlistItem.create({
        data: {
          playlistId: pl.id,
          contentId: item.contentId,
          durationSec: item.durationSec,
          orderIndex: i,
          crossfade: item.crossfade,
        },
      })
    ),
    prisma.playlist.update({ where: { id: pl.id }, data: { updatedAt: new Date() } }),
  ])

  // Push updated playlist to any devices currently playing it
  const updated = await prisma.playlist.findUnique({
    where: { id: pl.id },
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
      },
      devices: true
    },
  })
  for (const device of updated!.devices) {
    sendCommand(device.id, 'cmd:play', (deviceBaseUrl: string) => buildPlaylistPayload(updated!, deviceBaseUrl))
  }

  res.json(updated)
})

// POST /api/playlists/:id/deploy — push to one or many devices
router.post('/:id/deploy', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const pl = await prisma.playlist.findUnique({
    where: { id: req.params.id },
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
    },
  })
  if (!pl || !teamGuard(pl.teamId, req)) return res.status(404).json({ error: 'Not found' })

  const body = z.object({ deviceIds: z.array(z.string()) }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  // Find target devices belonging to this team
  const targetDevices = await prisma.device.findMany({
    where: { id: { in: body.data.deviceIds }, teamId: pl.teamId },
    select: { id: true },
  })
  const targetIds = targetDevices.map((d) => d.id)

  // Update validated devices
  await prisma.device.updateMany({
    where: { id: { in: targetIds } },
    data: { currentPlaylistId: pl.id, manualPlaylistId: pl.id },
  })

  // Push to each online device immediately
  let pushed = 0
  for (const id of targetIds) {
    if (sendCommand(id, 'cmd:play', (deviceBaseUrl: string) => buildPlaylistPayload(pl, deviceBaseUrl))) pushed++
  }

  res.json({ deployed: targetIds.length, pushed })
})

// POST /api/playlists/:id/duplicate
router.post('/:id/duplicate', requireRole('CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const pl = await prisma.playlist.findUnique({
    where: { id: req.params.id },
    include: { items: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!pl || !teamGuard(pl.teamId, req)) return res.status(404).json({ error: 'Not found' })

  const copy = await prisma.playlist.create({
    data: {
      name: `${pl.name} (copy)`,
      teamId: pl.teamId,
      createdBy: req.user!.id,
      items: {
        create: pl.items.map(item => ({
          contentId:   item.contentId,
          durationSec: item.durationSec,
          orderIndex:  item.orderIndex,
          crossfade:   item.crossfade,
        })),
      },
    },
  })
  res.json(copy)
})

export default router
