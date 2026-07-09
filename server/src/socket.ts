import { Server, Socket } from 'socket.io'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import prisma from './prisma'

const MEDIA_PATH = process.env.MEDIA_PATH || '/media'
const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3001'

export function getSocketBaseUrl(socket: Socket): string {
  const proto = socket.handshake.headers['x-forwarded-proto'] || (socket.handshake.secure ? 'https' : 'http')
  const host = socket.handshake.headers.host || baseUrl
  return `${proto}://${host}`
}

// Track live device connections
const deviceSockets = new Map<string, Socket>() // deviceId → socket
const socketDevices = new Map<string, string>()  // socketId → deviceId

// Track active client terminal sessions: clientId -> { deviceId, deviceSocketId }
const clientTerminalSessions = new Map<string, { deviceId: string; deviceSocketId: string }>()

function isTeamExpired(team: { createdAt: Date; isPremium: boolean }) {
  if (team.isPremium) return false
  const trialDurationMs = 30 * 24 * 60 * 60 * 1000 // 30 days
  const elapsedMs = Date.now() - new Date(team.createdAt).getTime()
  return elapsedMs > trialDurationMs
}

export function initSocketManager(io: Server) {
  io.on('connection', (socket) => {
    // Check if this connection is an admin client using a JWT token
    const token = socket.handshake.auth?.token || socket.handshake.query?.token
    let user: any = null
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as any
        user = { id: payload.sub, role: payload.role, teamId: payload.teamId }
      } catch (err) {
        // Invalid token
      }
    }

    if (user && (user.role === 'TEAM_ADMIN' || user.role === 'SUPER_ADMIN')) {
      // Admin client terminal handlers
      socket.on('terminal:start', async ({ deviceId }) => {
        try {
          const device = await prisma.device.findUnique({ where: { id: deviceId } })
          if (!device) return socket.emit('terminal:error', 'Device not found')
          if (user.role !== 'SUPER_ADMIN' && device.teamId !== user.teamId) {
            return socket.emit('terminal:error', 'Unauthorized')
          }

          const deviceSocket = deviceSockets.get(deviceId)
          if (!deviceSocket) return socket.emit('terminal:error', 'Device offline')

          socket.join(`terminal-${socket.id}`)
          clientTerminalSessions.set(socket.id, { deviceId, deviceSocketId: deviceSocket.id })

          deviceSocket.emit('cmd:terminal_start', { sessionId: socket.id })
        } catch (err: any) {
          socket.emit('terminal:error', err.message || 'Failed to start terminal')
        }
      })

      socket.on('terminal:input', ({ data }) => {
        const session = clientTerminalSessions.get(socket.id)
        if (!session) return
        const deviceSocket = io.sockets.sockets.get(session.deviceSocketId)
        if (deviceSocket) {
          deviceSocket.emit('cmd:terminal_input', { sessionId: socket.id, data })
        }
      })

      socket.on('terminal:resize', ({ cols, rows }) => {
        const session = clientTerminalSessions.get(socket.id)
        if (!session) return
        const deviceSocket = io.sockets.sockets.get(session.deviceSocketId)
        if (deviceSocket) {
          deviceSocket.emit('cmd:terminal_resize', { sessionId: socket.id, cols, rows })
        }
      })

      const cleanupTerminal = () => {
        const session = clientTerminalSessions.get(socket.id)
        if (session) {
          const deviceSocket = io.sockets.sockets.get(session.deviceSocketId)
          if (deviceSocket) {
            deviceSocket.emit('cmd:terminal_stop', { sessionId: socket.id })
          }
          clientTerminalSessions.delete(socket.id)
        }
      }

      socket.on('terminal:stop', cleanupTerminal)
      socket.on('disconnect', cleanupTerminal)
    }
    // ── Device registration ────────────────────────────────────────────────
    socket.on('device:hello', async ({ registrationKey, version }) => {
      const device = await prisma.device.findUnique({
        where: { registrationKey },
        include: {
          team: true,
          grid: true,
          widgets: true,
          currentPlaylist: {
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
          },
        },
      })

      if (!device) {
        socket.emit('error', 'Unknown registration key')
        socket.disconnect()
        return
      }

      // Map both directions
      deviceSockets.set(device.id, socket)
      socketDevices.set(socket.id, device.id)

      await prisma.device.update({
        where: { id: device.id },
        data: { status: 'ONLINE', lastSeen: new Date(), agentVersion: version },
      })

      console.log(`[socket] Device connected: ${device.name} (${device.id})`)

      // Ask the agent to report its screen info right away
      socket.emit('cmd:get_info')

      // Push team branding, grid settings, and active widgets to the device
      await pushDeviceSettings(device.id)
      const socketBaseUrl = getSocketBaseUrl(socket)
      const expired = isTeamExpired(device.team)

      // Push its current playlist if assigned and not expired
      if (device.currentPlaylist && !expired) {
        socket.emit('cmd:play', buildPlaylistPayload(device.currentPlaylist, socketBaseUrl))
      }
    })

    // ── Device terminal output ─────────────────────────────────────────────
    socket.on('device:terminal_output', ({ sessionId, data }) => {
      io.to(`terminal-${sessionId}`).emit('terminal:output', { data })
    })

    // ── Screen info report ─────────────────────────────────────────────────
    socket.on('device:info', async ({ screenWidth, screenHeight, ipAddress }) => {
      const deviceId = socketDevices.get(socket.id)
      if (!deviceId) return
      await prisma.device.update({
        where: { id: deviceId },
        data: { screenWidth, screenHeight, ipAddress },
      })
    })

    // ── Heartbeat ──────────────────────────────────────────────────────────
    socket.on('device:heartbeat', async (payload) => {
      const deviceId = socketDevices.get(socket.id)
      if (!deviceId) return
      await prisma.device.update({
        where: { id: deviceId },
        data: {
          lastSeen: new Date(),
          status: 'ONLINE',
          cpuUsage: payload.cpuUsage !== undefined ? payload.cpuUsage : null,
          cpuTemp: payload.cpuTemp !== undefined ? payload.cpuTemp : null,
          memUsage: payload.memUsage !== undefined ? payload.memUsage : null,
          diskUsage: payload.diskUsage !== undefined ? payload.diskUsage : null,
          uptime: payload.uptime !== undefined ? payload.uptime : null,
        },
      })
    })

    // ── Log lines from device ──────────────────────────────────────────────
    socket.on('device:log', async ({ level, message }) => {
      const deviceId = socketDevices.get(socket.id)
      if (!deviceId) return
      await prisma.deviceLog.create({ data: { deviceId, level, message } })
      // Trim to last 1000 logs per device
      const old = await prisma.deviceLog.findMany({
        where: { deviceId },
        orderBy: { createdAt: 'asc' },
        skip: 1000,
        select: { id: true },
      })
      if (old.length) {
        await prisma.deviceLog.deleteMany({ where: { id: { in: old.map((l) => l.id) } } })
      }
    })

    // ── Bulk log lines from device ─────────────────────────────────────────
    socket.on('device:logs', async ({ lines }: { lines: string[] }) => {
      const deviceId = socketDevices.get(socket.id)
      if (!deviceId || !lines) return
      try {
        const logsData = lines.map(line => {
          let level = 'info'
          if (line.includes(' WARNING ') || line.includes(' WARN ')) level = 'warn'
          else if (line.includes(' ERROR ')) level = 'error'
          return {
            deviceId,
            level,
            message: line,
          }
        })
        // In a transaction, delete existing logs for this device and insert new ones
        await prisma.$transaction([
          prisma.deviceLog.deleteMany({ where: { deviceId } }),
          prisma.deviceLog.createMany({ data: logsData })
        ])
        console.log(`[socket] Bulk logs saved for device ${deviceId}`)
      } catch (err) {
        console.error(`[socket] Failed to save bulk device logs:`, err)
      }
    })

    // ── Command acknowledgement ────────────────────────────────────────────
    socket.on('device:ack', ({ commandId, success, error }) => {
      const deviceId = socketDevices.get(socket.id)
      console.log(`[socket] ACK from ${deviceId}: cmd=${commandId} ok=${success} ${error || ''}`)
    })

    // ── Screenshot from device ─────────────────────────────────────────────
    socket.on('device:screenshot', async ({ data }: { data: string; mime: string }) => {
      const deviceId = socketDevices.get(socket.id)
      if (!deviceId || !data) return
      try {
        const dir = path.join(MEDIA_PATH, 'screenshots')
        fs.mkdirSync(dir, { recursive: true })
        const filename = `${deviceId}.png`
        fs.writeFileSync(path.join(dir, filename), Buffer.from(data, 'base64'))
        await prisma.device.update({
          where: { id: deviceId },
          data: {
            screenshotUrl: `/media/screenshots/${filename}`,
            screenshotAt:  new Date(),
          },
        })
        console.log(`[socket] Screenshot saved for device ${deviceId}`)
      } catch (err) {
        console.error(`[socket] Screenshot save failed:`, err)
      }
    })

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      const deviceId = socketDevices.get(socket.id)
      if (!deviceId) return
      deviceSockets.delete(deviceId)
      socketDevices.delete(socket.id)

      // Clean up terminal sessions pointing to this device
      for (const [clientId, session] of clientTerminalSessions.entries()) {
        if (session.deviceId === deviceId) {
          io.to(`terminal-${clientId}`).emit('terminal:error', 'Device disconnected')
          clientTerminalSessions.delete(clientId)
        }
      }

      await prisma.device.update({
        where: { id: deviceId },
        data: { status: 'OFFLINE' },
      })
      console.log(`[socket] Device disconnected: ${deviceId}`)
    })
  })
}

// ── Helpers used by routes and scheduler ──────────────────────────────────────

export async function pushDeviceSettings(deviceId: string) {
  try {
    const socket = deviceSockets.get(deviceId)
    if (!socket) return false

    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        team: true,
        grid: true,
        widgets: true,
      }
    })
    if (!device) return false

    const socketBaseUrl = getSocketBaseUrl(socket)
    const expired = isTeamExpired(device.team)

    socket.emit('cmd:settings', {
      splashUrl: device.team.splashPath
        ? `${socketBaseUrl}/media/${device.team.splashPath}`
        : null,
      orientation: device.orientation,
      grid: device.grid ? {
        rows: device.grid.rows,
        cols: device.grid.cols,
        row: device.gridRow,
        col: device.gridCol,
      } : null,
      widgets: device.widgets.map(w => {
        let parsedSettings = {}
        try {
          parsedSettings = JSON.parse(w.settings)
        } catch (e) {
          console.error(`[socket] Failed to parse settings for widget ${w.id}:`, e)
        }
        return {
          id: w.id,
          name: w.name,
          type: w.type,
          position: w.position,
          settings: parsedSettings
        }
      }),
      trialExpired: expired
    })
    return true
  } catch (err) {
    console.error(`[socket] Failed to push settings for device ${deviceId}:`, err)
    return false
  }
}

export async function syncTeamSettings(teamId: string) {
  try {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { devices: true }
    })
    if (!team) return

    for (const device of team.devices) {
      const d = await prisma.device.findUnique({
        where: { id: device.id },
        include: { grid: true }
      })
      if (d) {
        sendCommand(d.id, 'cmd:settings', (deviceBaseUrl: string) => ({
          splashUrl: team.splashPath ? `${deviceBaseUrl}/media/${team.splashPath}` : null,
          grid: d.grid ? {
            rows: d.grid.rows,
            cols: d.grid.cols,
            row: d.gridRow,
            col: d.gridCol,
          } : null
        }))
      }
    }
  } catch (err) {
    console.error(`[socket] Failed to sync team settings for team ${teamId}:`, err)
  }
}

export function sendCommand(deviceId: string, event: string, payload?: any) {
  const socket = deviceSockets.get(deviceId)
  if (!socket) return false

  let finalPayload = payload
  if (typeof payload === 'function') {
    finalPayload = payload(getSocketBaseUrl(socket))
  }

  socket.emit(event, finalPayload)
  return true
}

export function isDeviceOnline(deviceId: string) {
  return deviceSockets.has(deviceId)
}

export function buildPlaylistPayload(playlist: any, deviceBaseUrl?: string) {
  const activeBaseUrl = deviceBaseUrl || baseUrl
  let flatIndex = 0
  return {
    id: playlist.id,
    name: playlist.name,
    items: playlist.items.flatMap((item: any) => {
      const content = item.content
      const now = new Date()
      if (content.validFrom && new Date(content.validFrom) > now) return []
      if (content.validUntil && new Date(content.validUntil) < now) return []

      if ((content.type === 'SLIDES_URL' || content.type === 'PDF') && content.slideImages && content.slideImages.length > 0) {
        // Expand slide pages into individual image playlist items
        const slideCount = content.slideImages.length
        const perSlideDuration = Math.max(1, Math.round(item.durationSec / slideCount))

        return content.slideImages.map((slide: any) => ({
          id: `${item.id}-slide-${slide.id}`,
          durationSec: perSlideDuration,
          orderIndex: flatIndex++,
          content: {
            id: `${content.id}-slide-${slide.id}`,
            type: 'IMAGE',
            name: `${content.name} (Slide ${slide.orderIndex + 1})`,
            url: null,
            fileUrl: `${activeBaseUrl}/media/${slide.filePath}`,
            checksum: content.checksum || null,
            mimeType: 'image/png',
            crossfade: item.crossfade,
            muted: content.muted,
            scale: content.scale || 'FIT',
            validFrom: content.validFrom ? content.validFrom.toISOString() : null,
            validUntil: content.validUntil ? content.validUntil.toISOString() : null,
          }
        }))
      } else {
        // Normal playlist item
        return [{
          id: item.id,
          durationSec: item.durationSec,
          orderIndex: flatIndex++,
          content: {
            id: content.id,
            type: content.type,
            name: content.name,
            url: content.url,
            fileUrl: content.filePath
              ? `${activeBaseUrl}/media/${content.filePath}`
              : null,
            checksum: content.checksum,
            mimeType: content.mimeType,
            crossfade: item.crossfade,
            muted: content.muted,
            scale: content.scale,
            validFrom: content.validFrom ? content.validFrom.toISOString() : null,
            validUntil: content.validUntil ? content.validUntil.toISOString() : null,
          }
        }]
      }
    }),
  }
}
