import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole, teamGuard } from '../middleware/rbac'
import { sendCommand, pushDeviceSettings } from '../socket'

const router = Router()
router.use(requireAuth)

// Helper to assert that the active team is premium
async function checkPremium(req: AuthRequest, res: any, next: any) {
  if (!req.user!.teamId) {
    return res.status(400).json({ error: 'Please select an organization first' })
  }
  const team = await prisma.team.findUnique({ where: { id: req.user!.teamId } })
  if (!team) return res.status(404).json({ error: 'Organization not found' })
  if (!team.isPremium) {
    return res.status(403).json({ error: 'This feature is only available for premium organizations' })
  }
  next()
}

// GET /api/grids - List all grids for the active organization
router.get('/', checkPremium, async (req: AuthRequest, res) => {
  const grids = await prisma.deviceGrid.findMany({
    where: { teamId: req.user!.teamId! },
    include: {
      devices: {
        select: { id: true, name: true, gridRow: true, gridCol: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
  res.json(grids)
})

// POST /api/grids - Create a new grid
router.post('/', checkPremium, requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const body = z.object({
    name: z.string().min(1),
    rows: z.number().int().min(1).max(10),
    cols: z.number().int().min(1).max(10),
  }).safeParse(req.body)
  
  if (!body.success) return res.status(400).json({ error: body.error.issues })
  
  const grid = await prisma.deviceGrid.create({
    data: {
      name: body.data.name,
      rows: body.data.rows,
      cols: body.data.cols,
      teamId: req.user!.teamId!,
    }
  })
  res.json(grid)
})

// GET /api/grids/:id - Get a specific grid
router.get('/:id', checkPremium, async (req: AuthRequest, res) => {
  const grid = await prisma.deviceGrid.findUnique({
    where: { id: req.params.id },
    include: {
      devices: {
        select: { id: true, name: true, gridRow: true, gridCol: true }
      }
    }
  })
  if (!grid || !teamGuard(grid.teamId, req)) {
    return res.status(404).json({ error: 'Grid not found' })
  }
  res.json(grid)
})

// PATCH /api/grids/:id - Update grid info and member devices
router.patch('/:id', checkPremium, requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const grid = await prisma.deviceGrid.findUnique({ where: { id: req.params.id } })
  if (!grid || !teamGuard(grid.teamId, req)) {
    return res.status(404).json({ error: 'Grid not found' })
  }
  
  const body = z.object({
    name: z.string().min(1).optional(),
    rows: z.number().int().min(1).max(10).optional(),
    cols: z.number().int().min(1).max(10).optional(),
    deviceAssignments: z.array(z.object({
      deviceId: z.string(),
      row: z.number().int().min(0),
      col: z.number().int().min(0),
    })).optional(),
  }).safeParse(req.body)
  
  if (!body.success) return res.status(400).json({ error: body.error.issues })
  
  try {
    const updatedGrid = await prisma.$transaction(async (tx) => {
      const updated = await tx.deviceGrid.update({
        where: { id: grid.id },
        data: {
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          ...(body.data.rows !== undefined ? { rows: body.data.rows } : {}),
          ...(body.data.cols !== undefined ? { cols: body.data.cols } : {}),
        }
      })
      
      if (body.data.deviceAssignments !== undefined) {
        // 1. Clear grid configuration of all current members of this grid
        await tx.device.updateMany({
          where: { gridId: grid.id },
          data: { gridId: null, gridRow: null, gridCol: null }
        })
        
        // 2. Assign the new device coordinates
        for (const assignment of body.data.deviceAssignments) {
          const device = await tx.device.findUnique({ where: { id: assignment.deviceId } })
          if (!device || device.teamId !== grid.teamId) {
            throw new Error(`Device ${assignment.deviceId} not found or belongs to another organization`)
          }
          
          await tx.device.update({
            where: { id: assignment.deviceId },
            data: {
              gridId: grid.id,
              gridRow: assignment.row,
              gridCol: assignment.col
            }
          })
        }
      }
      
      return updated
    })

    // Fetch and sync connected devices in this grid immediately
    const finalDevices = await prisma.device.findMany({
      where: { gridId: grid.id },
      include: { team: true, grid: true }
    })
    
    for (const d of finalDevices) {
      await pushDeviceSettings(d.id)
    }
    
    res.json(updatedGrid)
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update grid' })
  }
})

// DELETE /api/grids/:id - Delete a grid
router.delete('/:id', checkPremium, requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const grid = await prisma.deviceGrid.findUnique({ where: { id: req.params.id } })
  if (!grid || !teamGuard(grid.teamId, req)) {
    return res.status(404).json({ error: 'Grid not found' })
  }
  
  // Find member devices before deletion so we can reset their settings
  const memberDevices = await prisma.device.findMany({
    where: { gridId: grid.id },
    include: { team: true }
  })
  
  await prisma.$transaction([
    prisma.device.updateMany({
      where: { gridId: grid.id },
      data: { gridId: null, gridRow: null, gridCol: null }
    }),
    prisma.deviceGrid.delete({
      where: { id: grid.id }
    })
  ])
  
  // Notify devices that they are no longer in a grid
  for (const d of memberDevices) {
    await pushDeviceSettings(d.id)
  }
  
  res.json({ ok: true })
})

export default router
