import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { createServer } from 'http'
import { Server } from 'socket.io'
import helmet from 'helmet'
import { initSocketManager } from './socket'
import { initScheduler } from './services/scheduler'
import { globalLimiter, authLimiter } from './middleware/rateLimiter'
import authRoutes from './routes/auth'
import deviceRoutes from './routes/devices'
import playlistRoutes from './routes/playlists'
import contentRoutes from './routes/content'
import scheduleRoutes from './routes/schedules'
import userRoutes from './routes/users'
import teamRoutes from './routes/team'
import gridsRoutes from './routes/grids'
import groupRoutes from './routes/groups'
import widgetRoutes from './routes/widgets'
import systemRoutes from './routes/system'
import prisma from './prisma'

const app = express()

// Trust reverse proxy (Nginx) to get correct client IP for rate limiting
app.set('trust proxy', 1)

// Secure HTTP headers (allow cross-origin resource sharing for media files)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

const httpServer = createServer(app)

export const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for screenshots
})

app.use(cors())
app.use(express.json({ limit: '100kb' })) // Limit JSON payload size to prevent DoS

// Egress tracking & limit validation middleware for media downloads
app.use('/media', async (req, res, next) => {
  const parts = req.path.split('/').filter(Boolean)
  const firstPart = parts[0]

  if (!firstPart) {
    return next()
  }

  // Bypass limit check for thumbnails and screenshots (system assets)
  if (firstPart === 'screenshots' || firstPart === 'thumbnails') {
    const type = firstPart === 'screenshots' ? 'SCREENSHOT' : 'MEDIA'
    res.on('finish', async () => {
      const contentLength = res.get('Content-Length')
      if (contentLength && (res.statusCode === 200 || res.statusCode === 206)) {
        const bytes = parseInt(contentLength, 10)
        if (!isNaN(bytes) && bytes > 0) {
          try {
            await prisma.egressLog.create({
              data: {
                type,
                bytes,
                path: req.originalUrl,
              }
            })
          } catch (err) {
            console.error('Failed to log egress:', err)
          }
        }
      }
    })
    return next()
  }

  // Parse teamId from first directory path
  const teamId = firstPart
  const MEDIA_PATH = process.env.MEDIA_PATH || '/media'
  const fullPath = path.join(MEDIA_PATH, req.path)

  if (!fs.existsSync(fullPath)) {
    return next()
  }

  try {
    const stats = fs.statSync(fullPath)
    const bytes = stats.size

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { maxEgressMonthly: true, currentEgressMonthly: true }
    })

    if (team) {
      if (team.currentEgressMonthly + bytes > team.maxEgressMonthly) {
        return res.status(402).json({
          error: 'Bandwidth limit exceeded. This organization has reached its monthly download (egress) quota.'
        })
      }

      // Track egress consumption on request completion
      res.on('finish', async () => {
        if (res.statusCode === 200 || res.statusCode === 206) {
          try {
            await prisma.$transaction([
              prisma.team.update({
                where: { id: teamId },
                data: { currentEgressMonthly: { increment: bytes } }
              }),
              prisma.egressLog.create({
                data: {
                  type: 'MEDIA',
                  bytes,
                  path: req.originalUrl,
                  teamId,
                }
              })
            ])
          } catch (err) {
            console.error('Failed to log team egress:', err)
          }
        }
      })
    }
  } catch (err) {
    console.error('Egress middleware check error:', err)
  }

  next()
})

// Serve uploaded media files
app.use('/media', express.static(process.env.MEDIA_PATH || '/media'))

// Serve RPi agent installer and scripts
app.use('/api/install', express.static(path.join(process.cwd(), '../rpi-agent')))

// API routes
app.use('/api/auth',      authLimiter, authRoutes)
app.use('/api/devices',   globalLimiter, deviceRoutes)
app.use('/api/playlists', globalLimiter, playlistRoutes)
app.use('/api/content',   globalLimiter, contentRoutes)
app.use('/api/schedules', globalLimiter, scheduleRoutes)
app.use('/api/users',     globalLimiter, userRoutes)
app.use('/api/team',      globalLimiter, teamRoutes)
app.use('/api/grids',     globalLimiter, gridsRoutes)
app.use('/api/groups',    globalLimiter, groupRoutes)
app.use('/api/widgets',   globalLimiter, widgetRoutes)
app.use('/api/system',    globalLimiter, systemRoutes)

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true }))

// Init real-time device management
initSocketManager(io)

// Init playlist scheduler
initScheduler(io)

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`Server running on :${PORT}`)
})
