import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole, teamGuard } from '../middleware/rbac'
import { sendCommand, isDeviceOnline, buildPlaylistPayload, pushDeviceSettings } from '../socket'

const router = Router()

// Memory store for pending pairing codes (expires in 10 minutes)
interface PendingPairing {
  code: string;
  registrationKey?: string;
  createdAt: number;
}
const pendingPairings = new Map<string, PendingPairing>();

// Clean up expired codes every minute
setInterval(() => {
  const now = Date.now();
  for (const [code, pairing] of pendingPairings.entries()) {
    if (now - pairing.createdAt > 10 * 60 * 1000) {
      pendingPairings.delete(code);
    }
  }
}, 60 * 1000);

// POST /api/devices/pair/code - Generate a pairing code for a web player (Public)
router.post('/pair/code', (req, res) => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  // Generate a unique code
  for (let attempt = 0; attempt < 10; attempt++) {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!pendingPairings.has(code)) break;
  }
  pendingPairings.set(code, {
    code,
    createdAt: Date.now()
  });
  
  res.json({ code });
});

// GET /api/devices/pair/status - Poll status of a pairing code (Public)
router.get('/pair/status', (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Pairing code is required' });
  }
  
  const pairing = pendingPairings.get(code.toUpperCase());
  if (!pairing) {
    return res.status(404).json({ error: 'Pairing code expired or not found' });
  }
  
  if (pairing.registrationKey) {
    // Delete it from the map after it is successfully retrieved
    pendingPairings.delete(code.toUpperCase());
    return res.json({ registered: true, registrationKey: pairing.registrationKey });
  }
  
  res.json({ registered: false });
});

router.use(requireAuth)

// GET /api/devices — list all devices for the user's team
router.get('/', async (req: AuthRequest, res) => {
  const where: any = req.user!.teamId ? { teamId: req.user!.teamId } : {}
  console.log('[Devices GET Debug]', {
    role: req.user!.role,
    resolvedTeamId: req.user!.teamId,
    where
  })
  if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'TEAM_ADMIN') {
    const assignedCount = await prisma.device.count({
      where: {
        teamId: req.user!.teamId || undefined,
        assignedUsers: { some: { id: req.user!.id } }
      }
    })
    if (assignedCount > 0) {
      where.assignedUsers = { some: { id: req.user!.id } }
    }
  }
  const devices = await prisma.device.findMany({
    where,
    include: {
      currentPlaylist: { select: { id: true, name: true } },
      widgets: true,
      assignedUsers: { select: { id: true, name: true, email: true } },
      _count: { select: { schedules: true } },
    },
    orderBy: { name: 'asc' },
  })
  // Merge live socket status
  const result = devices.map((d) => ({ ...d, online: isDeviceOnline(d.id) }))
  res.json(result)
})

// POST /api/devices — register a new device slot (generates a registration key)
router.post('/', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const body = z.object({
    name: z.string(),
    location: z.string().optional(),
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

  // Check device limit for the organization
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { maxDevices: true }
  })
  if (!team) return res.status(400).json({ error: 'Organization not found' })

  const deviceCount = await prisma.device.count({
    where: { teamId }
  })

  if (deviceCount >= team.maxDevices) {
    return res.status(400).json({
      error: `Device limit reached. Your organization is allowed a maximum of ${team.maxDevices} device(s). Please contact support to upgrade.`
    })
  }

  const device = await prisma.device.create({
    data: { name: body.data.name, location: body.data.location, teamId },
  })
  res.json(device)
})

// PATCH /api/devices/:id
router.patch('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } })
  if (!device || !teamGuard(device.teamId, req)) return res.status(404).json({ error: 'Not found' })

  const body = z.object({
    name:              z.string().optional(),
    location:          z.string().optional(),
    currentPlaylistId: z.string().nullable().optional(),
    assignedUserIds:   z.array(z.string()).optional(),
    teamId:            z.string().optional(),
    orientation:       z.enum(['LANDSCAPE', 'PORTRAIT', 'LANDSCAPE_FLIPPED', 'PORTRAIT_FLIPPED']).optional(),
  }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  // Restrict teamId changes to SUPER_ADMIN
  if (body.data.teamId !== undefined && req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only Super Admins can move devices to other organizations' })
  }

  // Verify that target playlist belongs to this device's team (or target team)
  const targetTeamId = body.data.teamId !== undefined ? body.data.teamId : device.teamId
  if (body.data.currentPlaylistId) {
    const playlist = await prisma.playlist.findUnique({ where: { id: body.data.currentPlaylistId } })
    if (!playlist || playlist.teamId !== targetTeamId) {
      return res.status(400).json({ error: 'Playlist not found or belongs to a different organization' })
    }
  }

  const updateData: Record<string, any> = {
    ...(body.data.name !== undefined ? { name: body.data.name } : {}),
    ...(body.data.location !== undefined ? { location: body.data.location } : {}),
    ...(body.data.currentPlaylistId !== undefined ? { currentPlaylistId: body.data.currentPlaylistId } : {}),
    ...(body.data.orientation !== undefined ? { orientation: body.data.orientation } : {}),
  }

  if (body.data.currentPlaylistId !== undefined) {
    updateData.manualPlaylistId = body.data.currentPlaylistId
  }

  // Handle cross-organization move
  if (body.data.teamId !== undefined && body.data.teamId !== device.teamId) {
    const targetTeam = await prisma.team.findUnique({ where: { id: body.data.teamId } })
    if (!targetTeam) return res.status(400).json({ error: 'Target organization not found' })

    updateData.teamId = body.data.teamId
    updateData.currentPlaylistId = null
    updateData.manualPlaylistId = null
    updateData.assignedUsers = { set: [] }

    // Clean up organization-specific associations
    await prisma.schedule.deleteMany({ where: { deviceId: device.id } })
    await prisma.deviceGroupMember.deleteMany({ where: { deviceId: device.id } })
  }

  // Verify and update many-to-many user assignments
  if (body.data.assignedUserIds !== undefined && updateData.teamId === undefined) {
    const usersCount = await prisma.user.count({
      where: {
        id: { in: body.data.assignedUserIds },
        teamId: device.teamId
      }
    })
    if (usersCount !== body.data.assignedUserIds.length) {
      return res.status(400).json({ error: 'One or more assigned users not found or belong to another organization' })
    }
    updateData.assignedUsers = {
      set: body.data.assignedUserIds.map(id => ({ id }))
    }
  }

  const updated = await prisma.device.update({ where: { id: device.id }, data: updateData })

  // Push new settings to the device immediately
  await pushDeviceSettings(device.id)

  // Push to device immediately if playlist changed
  if (body.data.currentPlaylistId && body.data.currentPlaylistId !== device.currentPlaylistId) {
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
      },
    })
    if (playlist) sendCommand(device.id, 'cmd:play', (deviceBaseUrl: string) => buildPlaylistPayload(playlist, deviceBaseUrl))
  }

  res.json(updated)
})

// DELETE /api/devices/:id
router.delete('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } })
  if (!device || !teamGuard(device.teamId, req)) return res.status(404).json({ error: 'Not found' })
  await prisma.device.delete({ where: { id: device.id } })
  res.json({ ok: true })
})

// POST /api/devices/:id/cmd — send a remote command
router.post('/:id/cmd', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } })
  if (!device || !teamGuard(device.teamId, req)) return res.status(404).json({ error: 'Not found' })

  const { command } = req.body
  const allowed = ['cmd:restart', 'cmd:reboot', 'cmd:shutdown', 'cmd:get_logs', 'cmd:screenshot']
  if (!allowed.includes(command)) return res.status(400).json({ error: 'Unknown command' })

  const sent = sendCommand(device.id, command)
  res.json({ queued: sent, online: sent })
})

// GET /api/devices/:id/logs
router.get('/:id/logs', async (req: AuthRequest, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } })
  if (!device || !teamGuard(device.teamId, req)) return res.status(404).json({ error: 'Not found' })

  if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'TEAM_ADMIN') {
    const assignedCount = await prisma.device.count({
      where: {
        teamId: req.user!.teamId || undefined,
        assignedUsers: { some: { id: req.user!.id } }
      }
    })
    if (assignedCount > 0) {
      const isAssigned = await prisma.device.count({
        where: {
          id: device.id,
          assignedUsers: { some: { id: req.user!.id } }
        }
      })
      if (isAssigned === 0) {
        return res.status(403).json({ error: 'Access denied: Screen not assigned to you' })
      }
    }
  }

  const logs = await prisma.deviceLog.findMany({
    where: { deviceId: device.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json(logs)
})

// POST /api/devices/pair/register - Register a device using a pairing code (Authenticated)
router.post('/pair/register', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const body = z.object({
    code: z.string().length(6),
    name: z.string().min(1),
    location: z.string().optional(),
    teamId: z.string().optional(),
  }).safeParse(req.body);
  
  if (!body.success) return res.status(400).json({ error: body.error.issues });
  
  const code = body.data.code.toUpperCase();
  const pairing = pendingPairings.get(code);
  if (!pairing) {
    return res.status(400).json({ error: 'Invalid or expired pairing code' });
  }
  
  let teamId = req.user!.teamId;
  if (req.user!.role === 'SUPER_ADMIN' && body.data.teamId) {
    teamId = body.data.teamId;
  }
  
  if (!teamId) {
    return res.status(400).json({ error: 'Active team/organization is required for this action' });
  }
  
  const device = await prisma.device.create({
    data: {
      name: body.data.name,
      location: body.data.location || null,
      teamId,
    }
  });
  
  // Set the registration key on the pairing session so the player can retrieve it
  pairing.registrationKey = device.registrationKey;
  
  res.json(device);
});

export default router
