import cron from 'node-cron'
import { Server } from 'socket.io'
import prisma from '../prisma'
import { sendCommand, buildPlaylistPayload } from '../socket'
import { syncGoogleSlides } from '../routes/content'

const deviceActiveItemKeys = new Map<string, string>()

export function initScheduler(_io: Server) {
  // Check scheduler rules every minute
  cron.schedule('* * * * *', async () => {
    try { await evaluateSchedules() }
    catch (err) { console.error('[scheduler] Error:', err) }
  })

  // Synchronize Google Slides every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try { await syncAllGoogleSlides() }
    catch (err) { console.error('[scheduler] Google Slides sync error:', err) }
  })

  // Reset billing cycle monthly counters daily at midnight
  cron.schedule('0 0 * * *', async () => {
    try { await resetMonthlyLimits() }
    catch (err) { console.error('[scheduler] Quota reset error:', err) }
  })

  console.log('[scheduler] Started')
}

export function isTeamExpired(team: { createdAt: Date; isPremium: boolean }) {
  if (team.isPremium) return false
  const trialDurationMs = 30 * 24 * 60 * 60 * 1000 // 30 days
  const elapsedMs = Date.now() - new Date(team.createdAt).getTime()
  return elapsedMs > trialDurationMs
}

async function evaluateSchedules() {
  const now = new Date()
  const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const currentDay  = now.getDay()

  // Load all active schedules with their playlists
  const schedules = await prisma.schedule.findMany({
    where: { isActive: true },
    include: {
      playlist: {
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
      },
      device: true,
      group:  { include: { members: { include: { device: true } } } },
    },
  })

  // All devices with their teams
  const devices = await prisma.device.findMany({
    include: { team: true }
  })

  for (const device of devices) {
    if (isTeamExpired(device.team)) {
      if (device.currentPlaylistId !== null) {
        await prisma.device.update({
          where: { id: device.id },
          data: { currentPlaylistId: null }
        })
        sendCommand(device.id, 'cmd:clear', {})
        deviceActiveItemKeys.delete(device.id)
      }
      continue
    }

    // Find the highest-priority active schedule for this device
    const matching = schedules
      .filter(s => {
        if (!s.daysOfWeek.includes(currentDay)) return false
        if (!timeInWindow(currentTime, s.startTime, s.endTime)) return false
        if (s.deviceId && s.deviceId !== device.id) return false
        if (s.groupId) {
          const inGroup = s.group?.members.some(m => m.deviceId === device.id)
          if (!inGroup) return false
        }
        if (!s.deviceId && !s.groupId) return false
        return true
      })
      .sort((a, b) => b.priority - a.priority)

    // Determine target: scheduled playlist or fall back to manualPlaylistId
    const targetPlaylistId = matching.length > 0
      ? matching[0].playlistId
      : (device.manualPlaylistId ?? null)

    // Find the full playlist with items to evaluate validity
    let playlistPayload: any = null
    let activeItemKey = ''

    if (targetPlaylistId) {
      playlistPayload = matching.length > 0
        ? matching[0].playlist
        : await prisma.playlist.findUnique({
            where: { id: targetPlaylistId },
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

      if (playlistPayload) {
        const activeItems = playlistPayload.items.filter((item: any) => {
          const content = item.content
          if (content.validFrom && new Date(content.validFrom) > now) return false
          if (content.validUntil && new Date(content.validUntil) < now) return false
          return true
        })
        activeItemKey = activeItems.map((i: any) => i.id).join(',')
      }
    }

    const playlistIdChanged = targetPlaylistId !== device.currentPlaylistId
    const cachedItemKey = deviceActiveItemKeys.get(device.id) || ''
    const itemsChanged = activeItemKey !== cachedItemKey

    if (playlistIdChanged || itemsChanged) {
      deviceActiveItemKeys.set(device.id, activeItemKey)

      if (playlistIdChanged) {
        await prisma.device.update({
          where: { id: device.id },
          data:  { currentPlaylistId: targetPlaylistId },
        })
      }

      if (!targetPlaylistId) {
        sendCommand(device.id, 'cmd:clear', {})
        console.log(`[scheduler] Cleared playlist for device ${device.id}`)
      } else if (playlistPayload) {
        sendCommand(device.id, 'cmd:play', (deviceBaseUrl: string) => buildPlaylistPayload(playlistPayload, deviceBaseUrl))
        console.log(`[scheduler] Pushed "${playlistPayload.name}" to device ${device.id} (idChanged=${playlistIdChanged}, itemsChanged=${itemsChanged})`)
      }
    }
  }
}

export function timeInWindow(current: string, start: string, end: string): boolean {
  if (start <= end) return current >= start && current < end
  return current >= start || current < end  // overnight window
}

async function syncAllGoogleSlides() {
  const slides = await prisma.content.findMany({
    where: { type: 'SLIDES_URL' }
  })
  if (slides.length === 0) return

  console.log(`[scheduler] Starting background check for ${slides.length} Google Slides`)
  for (const item of slides) {
    try {
      const res = await syncGoogleSlides(item.id)
      if (res.updated) {
        console.log(`[scheduler] Google Slides "${item.name}" updated, pushing to active devices`)

        // Find active playlists containing this slides content
        const playlists = await prisma.playlist.findMany({
          where: { items: { some: { contentId: item.id } } },
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
          }
        })

        for (const pl of playlists) {
          for (const device of pl.devices) {
            sendCommand(device.id, 'cmd:play', (deviceBaseUrl: string) => buildPlaylistPayload(pl, deviceBaseUrl))
          }
        }
      }
    } catch (err: any) {
      console.error(`[scheduler] Failed to sync slides "${item.name}" (${item.id}):`, err.message)
    }
  }
}

export async function resetMonthlyLimits() {
  const now = new Date()
  const teamsToReset = await prisma.team.findMany({
    where: {
      billingCycleAnchor: { lte: now }
    }
  })

  for (const team of teamsToReset) {
    const nextMonth = new Date(team.billingCycleAnchor)
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)

    await prisma.team.update({
      where: { id: team.id },
      data: {
        currentIngressMonthly: 0,
        currentEgressMonthly: 0,
        billingCycleAnchor: nextMonth
      }
    })
    console.log(`[scheduler] Reset monthly bandwidth counters for team: ${team.name} (${team.id})`)
  }
}

