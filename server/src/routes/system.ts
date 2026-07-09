/*
 * Copyright (c) 2026 MyCompany LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Router } from 'express'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'

const router = Router()

router.use(requireAuth)
router.use(requireRole('SUPER_ADMIN'))

// GET /api/system/stats — Aggregated metrics for superadmins
router.get('/stats', async (req: AuthRequest, res) => {
  try {
    // 1. Egress aggregates
    const totalEgressSum = await prisma.egressLog.aggregate({
      _sum: { bytes: true }
    })
    const totalEgress = totalEgressSum._sum.bytes || 0

    const oneDayAgo = new Date()
    oneDayAgo.setDate(oneDayAgo.getDate() - 1)
    const dailyEgressSum = await prisma.egressLog.aggregate({
      where: { createdAt: { gte: oneDayAgo } },
      _sum: { bytes: true }
    })
    const egress24h = dailyEgressSum._sum.bytes || 0

    const typeBreakdown = await prisma.egressLog.groupBy({
      by: ['type'],
      _sum: { bytes: true }
    })
    const breakdown = typeBreakdown.map(item => ({
      type: item.type,
      bytes: item._sum.bytes || 0
    }))

    // Egress logs for the past 7 days
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)

    const egressLogs = await prisma.egressLog.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      select: { bytes: true, createdAt: true }
    })

    const dailyEgress: Record<string, number> = {}
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      dailyEgress[dateStr] = 0
    }

    egressLogs.forEach(log => {
      const dateStr = log.createdAt.toISOString().split('T')[0]
      if (dailyEgress[dateStr] !== undefined) {
        dailyEgress[dateStr] += log.bytes
      }
    })

    const egressHistory = Object.entries(dailyEgress)
      .map(([date, bytes]) => ({ date, bytes }))
      .reverse()

    // 2. Health & Active Devices
    const deviceStatuses = await prisma.device.groupBy({
      by: ['status'],
      _count: { _all: true }
    })
    const statusCounts = { ONLINE: 0, OFFLINE: 0, WARNING: 0 }
    deviceStatuses.forEach(item => {
      if (item.status in statusCounts) {
        statusCounts[item.status as keyof typeof statusCounts] = item._count._all
      }
    })

    // Get offline devices with team names
    const offlineDevices = await prisma.device.findMany({
      where: { status: 'OFFLINE' },
      select: {
        id: true,
        name: true,
        lastSeen: true,
        team: {
          select: { name: true }
        }
      },
      orderBy: { lastSeen: 'desc' },
      take: 10
    })

    // 3. Error logs
    const errorLogsCount = await prisma.deviceLog.count({
      where: { level: 'error' }
    })
    const warnLogsCount = await prisma.deviceLog.count({
      where: { level: 'warn' }
    })

    // Recent errors/warnings from all devices
    const recentErrors = await prisma.deviceLog.findMany({
      where: { level: { in: ['error', 'warn'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        device: {
          select: {
            name: true,
            team: {
              select: { name: true }
            }
          }
        }
      }
    })

    res.json({
      egress: {
        total: totalEgress,
        last24h: egress24h,
        breakdown,
        history: egressHistory
      },
      devices: {
        counts: statusCounts,
        offline: offlineDevices.map(d => ({
          id: d.id,
          name: d.name,
          lastSeen: d.lastSeen,
          teamName: d.team.name
        }))
      },
      logs: {
        errorCount: errorLogsCount,
        warnCount: warnLogsCount,
        recent: recentErrors.map(l => ({
          id: l.id,
          deviceId: l.deviceId,
          deviceName: l.device?.name || 'Unknown Device',
          teamName: l.device?.team?.name || 'Unknown Team',
          level: l.level,
          message: l.message,
          createdAt: l.createdAt
        }))
      }
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

// POST /api/system/logs/clear — Clear system wide device logs
router.post('/logs/clear', async (req: AuthRequest, res) => {
  const { days } = req.body
  try {
    let deleteWhere = {}
    if (days !== undefined && !isNaN(Number(days))) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - Number(days))
      deleteWhere = { createdAt: { lt: cutoff } }
    }

    const deleted = await prisma.deviceLog.deleteMany({
      where: deleteWhere
    })
    res.json({ success: true, count: deleted.count })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' })
  }
})

export default router
