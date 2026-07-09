import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs'
import { z } from 'zod'
import { exec } from 'child_process'
import { promisify } from 'util'
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import prisma from '../prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { requireRole, teamGuard } from '../middleware/rbac'

const execPromise = promisify(exec)
const finishedPromise = finished


let sharp: any = null
try { sharp = require('sharp') } catch { /* sharp optional */ }

const router = Router()
router.use(requireAuth)

const MEDIA_PATH = process.env.MEDIA_PATH || '/media'

const storage = multer.diskStorage({
  destination: (req: AuthRequest | any, _file, cb) => {
    let teamId = req.user!.teamId!
    if (req.user!.role === 'SUPER_ADMIN' && req.query.teamId) {
      teamId = req.query.teamId as string
    }
    const dir = path.join(MEDIA_PATH, teamId)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 512 * 1024 * 1024 }, // 512 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm',
      'application/pdf'
    ]
    cb(null, allowed.includes(file.mimetype))
  },
})

function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (d) => hash.update(d))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// Extract PDF pages as high-quality PNGs via native pdftoppm
async function extractPdfSlides(pdfPath: string, teamId: string): Promise<string[]> {
  const slidesDirName = `slides-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const destDir = path.join(MEDIA_PATH, teamId, slidesDirName)
  fs.mkdirSync(destDir, { recursive: true })

  const prefix = path.join(destDir, 'page')
  try {
    // -png: output PNG format, -r 150: render at 150 DPI for vector screen clarity
    await execPromise(`pdftoppm -png -r 150 "${pdfPath}" "${prefix}"`)
  } catch (err: any) {
    console.error('pdftoppm failed:', err)
    throw new Error(`PDF page extraction failed: ${err.message}`)
  }

  const files = fs.readdirSync(destDir)
    .filter(f => f.startsWith('page-') && f.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/page-(\d+)\.png/)?.[1] || '0')
      const numB = parseInt(b.match(/page-(\d+)\.png/)?.[1] || '0')
      return numA - numB
    })

  return files.map(f => path.join(teamId, slidesDirName, f))
}

// Generate thumbnail for a specific slide image
async function createThumbnail(srcPath: string, originalFilename: string): Promise<string | undefined> {
  if (!sharp) return undefined
  try {
    const thumbDir = path.join(MEDIA_PATH, 'thumbnails')
    fs.mkdirSync(thumbDir, { recursive: true })
    const baseName = path.basename(originalFilename).replace(/\.[^.]+$/, '')
    const thumbFile = `${baseName}-${Date.now()}_thumb.jpg`
    await sharp(srcPath)
      .resize(400, 225, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toFile(path.join(thumbDir, thumbFile))
    return `thumbnails/${thumbFile}`
  } catch (e) {
    console.warn('Thumbnail generation failed:', e)
    return undefined
  }
}

// Download utility using built-in fetch in Node 20
async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download presentation PDF: ${res.status} ${res.statusText}`)
  const fileStream = fs.createWriteStream(destPath)
  if (res.body) {
    // @ts-ignore
    await finishedPromise(Readable.fromWeb(res.body).pipe(fileStream))
  }
}

// Core Google Slides Sync Logic (downloads presentation PDF, extracts pages, updates database)
export async function syncGoogleSlides(contentId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId }
  })
  if (!content || content.type !== 'SLIDES_URL' || !content.url) {
    throw new Error('Invalid content item for slides sync')
  }

  const match = content.url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new Error('Invalid Google Slides presentation ID')
  const presentationId = match[1]
  const pdfUrl = `https://docs.google.com/presentation/d/${presentationId}/export/pdf`

  const tmpDir = path.join(MEDIA_PATH, 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmpPdfPath = path.join(tmpDir, `${contentId}-${Date.now()}.pdf`)

  try {
    await downloadFile(pdfUrl, tmpPdfPath)

    const stats = fs.statSync(tmpPdfPath)
    const fileSize = stats.size

    const team = await prisma.team.findUnique({
      where: { id: content.teamId },
      select: { maxIngressMonthly: true, currentIngressMonthly: true }
    })

    if (team && team.currentIngressMonthly + fileSize > team.maxIngressMonthly) {
      fs.unlinkSync(tmpPdfPath)
      throw new Error('Monthly upload (ingress) limit exceeded.')
    }

    if (team) {
      await prisma.team.update({
        where: { id: content.teamId },
        data: { currentIngressMonthly: { increment: fileSize } }
      })
    }

    const checksum = await sha256(tmpPdfPath)
    if (content.checksum === checksum) {
      // PDF hasn't changed, skip re-extracting
      fs.unlinkSync(tmpPdfPath)
      return { updated: false }
    }

    const slidePaths = await extractPdfSlides(tmpPdfPath, content.teamId)

    // Delete old slide files from disk
    const oldSlides = await prisma.slideImage.findMany({
      where: { contentId: content.id }
    })
    for (const slide of oldSlides) {
      const fullPath = path.join(MEDIA_PATH, slide.filePath)
      fs.rmSync(fullPath, { force: true })
    }

    let thumbnailPath: string | undefined
    if (slidePaths.length > 0) {
      thumbnailPath = await createThumbnail(path.join(MEDIA_PATH, slidePaths[0]), `${content.name}.png`)
    }

    await prisma.$transaction([
      prisma.slideImage.deleteMany({ where: { contentId: content.id } }),
      prisma.slideImage.createMany({
        data: slidePaths.map((filePath, index) => ({
          contentId: content.id,
          filePath,
          orderIndex: index,
        }))
      }),
      prisma.content.update({
        where: { id: content.id },
        data: {
          checksum,
          ...(thumbnailPath ? { thumbnailPath } : {})
        }
      })
    ])

    fs.unlinkSync(tmpPdfPath)
    return { updated: true }
  } catch (error) {
    if (fs.existsSync(tmpPdfPath)) fs.unlinkSync(tmpPdfPath)
    throw error
  }
}

// GET /api/content
router.get('/', async (req: AuthRequest, res) => {
  const where = req.user!.teamId ? { teamId: req.user!.teamId } : {}
  const content = await prisma.content.findMany({
    where,
    include: {
      _count: { select: { slideImages: true } }
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json(content)
})

// POST /api/content/upload — multipart file upload
router.post(
  '/upload',
  requireRole('CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'),
  async (req: AuthRequest, res, next) => {
    let teamId = req.user!.teamId
    if (req.user!.role === 'SUPER_ADMIN' && req.query.teamId) {
      teamId = req.query.teamId as string
      const teamExists = await prisma.team.findUnique({ where: { id: teamId } })
      if (!teamExists) return res.status(400).json({ error: 'Target organization not found' })
    }
    if (!teamId) {
      return res.status(400).json({ error: 'Active team/organization is required for this action' })
    }
    next()
  },
  upload.single('file'),
  async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    let teamId = req.user!.teamId!
    if (req.user!.role === 'SUPER_ADMIN' && req.query.teamId) {
      teamId = req.query.teamId as string
    }

    // Storage & Ingress Quota Enforcement
    try {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { maxStorage: true, maxIngressMonthly: true, currentIngressMonthly: true }
      })
      if (!team) {
        fs.unlinkSync(req.file.path)
        return res.status(404).json({ error: 'Organization not found' })
      }

      // Check Ingress Limit
      if (team.currentIngressMonthly + req.file.size > team.maxIngressMonthly) {
        fs.unlinkSync(req.file.path)
        const allowedGb = (team.maxIngressMonthly / (1024 * 1024 * 1024)).toFixed(2)
        return res.status(402).json({
          error: `Monthly upload (ingress) limit exceeded. This organization is allowed a maximum of ${allowedGb} GB of uploads per month.`
        })
      }

      // Check Storage Limit
      const storageUsedResult = await prisma.content.aggregate({
        where: { teamId },
        _sum: {
          fileSize: true
        }
      })
      const storageUsed = storageUsedResult._sum.fileSize || 0

      if (storageUsed + req.file.size > team.maxStorage) {
        fs.unlinkSync(req.file.path)
        const allowedGb = (team.maxStorage / (1024 * 1024 * 1024)).toFixed(3)
        return res.status(400).json({
          error: `Storage limit exceeded. This organization is allowed a maximum of ${allowedGb} GB of storage.`
        })
      }

      // Increment Ingress usage
      await prisma.team.update({
        where: { id: teamId },
        data: { currentIngressMonthly: { increment: req.file.size } }
      })
    } catch (err: any) {
      console.error('Quota check error:', err)
      fs.unlinkSync(req.file.path)
      return res.status(500).json({ error: 'Failed to verify quotas' })
    }

    const isVideo = req.file.mimetype.startsWith('video/')
    const isPdf = req.file.mimetype === 'application/pdf'
    const relPath = path.join(teamId, req.file.filename)
    const checksum = await sha256(req.file.path)

    if (isPdf) {
      // PDF presentation file handler
      const content = await prisma.content.create({
        data: {
          name: req.body.name || req.file.originalname,
          type: 'PDF',
          filePath: relPath,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          checksum,
          teamId,
          slideDuration: req.body.slideDuration ? parseInt(req.body.slideDuration) : 5,
          scale: req.body.scale === 'FILL' ? 'FILL' : 'FIT',
        },
      })

      try {
        const slidePaths = await extractPdfSlides(req.file.path, teamId)
        await prisma.slideImage.createMany({
          data: slidePaths.map((filePath, index) => ({
            contentId: content.id,
            filePath,
            orderIndex: index,
          }))
        })

        if (slidePaths.length > 0) {
          const thumbnailPath = await createThumbnail(path.join(MEDIA_PATH, slidePaths[0]), req.file.filename)
          await prisma.content.update({
            where: { id: content.id },
            data: { thumbnailPath }
          })
        }
      } catch (err: any) {
        console.error('PDF extraction failed:', err)
        // Clean up the parent content database record on failure
        await prisma.content.delete({ where: { id: content.id } })
        return res.status(500).json({ error: `Failed to process PDF pages: ${err.message}` })
      }

      const updated = await prisma.content.findUnique({ where: { id: content.id } })
      return res.json(updated)
    }

    // Generate thumbnail for regular images
    let thumbnailPath: string | undefined
    if (!isVideo && sharp) {
      thumbnailPath = await createThumbnail(req.file.path, req.file.filename)
    }

    const content = await prisma.content.create({
      data: {
        name: req.body.name || req.file.originalname,
        type: isVideo ? 'VIDEO' : 'IMAGE',
        filePath: relPath,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        checksum,
        thumbnailPath,
        teamId,
        muted: req.body.muted === 'false' ? false : true,
        scale: req.body.scale === 'FILL' ? 'FILL' : 'FIT',
      },
    })
    res.json(content)
  }
)

// POST /api/content/url — register a Slides or web URL
router.post('/url', requireRole('CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const body = z.object({
    name: z.string(),
    url: z.string().url(),
    type: z.enum(['SLIDES_URL', 'WEB_URL', 'CANVA_URL']),
    slideDuration: z.number().int().positive().optional(),
    teamId: z.string().optional(),
  }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  let teamId = req.user!.teamId
  if (req.user!.role === 'SUPER_ADMIN' && body.data.teamId) {
    teamId = body.data.teamId
    const teamExists = await prisma.team.findUnique({ where: { id: teamId } })
    if (!teamExists) return res.status(400).json({ error: 'Target organization not found' })
  }
  if (!teamId) {
    return res.status(400).json({ error: 'Active team/organization is required for this action' })
  }

  // Auto-convert Google Slides share URL → embed URL and detect delayms
  let finalUrl = body.data.url
  let slideDuration = body.data.slideDuration || 5
  if (body.data.type === 'SLIDES_URL') {
    const match = body.data.url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/)
    if (match) {
      try {
        const urlObj = new URL(body.data.url)
        const delayms = urlObj.searchParams.get('delayms')
        if (delayms) {
          const secs = Math.round(parseInt(delayms) / 1000)
          if (secs > 0) slideDuration = secs
        }
      } catch (e) {}
      finalUrl = `https://docs.google.com/presentation/d/${match[1]}/embed?start=true&loop=true&delayms=${slideDuration * 1000}`
    }
  }

  const content = await prisma.content.create({
    data: {
      name: body.data.name,
      type: body.data.type,
      url: finalUrl,
      teamId,
      slideDuration,
    },
  })

  // Trigger page extraction for Google Slides url immediately
  if (body.data.type === 'SLIDES_URL') {
    try {
      await syncGoogleSlides(content.id)
    } catch (err: any) {
      console.warn('Initial Google Slides sync failed:', err.message)
      // We do not fail the request, sync will retry via cron or manual sync button
    }
  }

  const freshContent = await prisma.content.findUnique({
    where: { id: content.id },
    include: { slideImages: true }
  })
  res.json(freshContent)
})

// PATCH /api/content/:id — edit name, url (for URL types)
router.patch('/:id', requireRole('CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const content = await prisma.content.findUnique({ where: { id: req.params.id } })
  if (!content || !teamGuard(content.teamId, req)) return res.status(404).json({ error: 'Not found' })

  const body = z.object({
    name: z.string().min(1).optional(),
    url: z.string().url().optional(),
    muted: z.boolean().optional(),
    scale: z.enum(['FIT', 'FILL', 'STRETCH']).optional(),
    validFrom: z.string().nullable().optional(),
    validUntil: z.string().nullable().optional(),
    slideDuration: z.number().int().positive().optional(),
  }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: body.error.issues })

  // Only URL-backed content can have its URL changed
  if (body.data.url && !['SLIDES_URL', 'WEB_URL', 'CANVA_URL'].includes(content.type)) {
    return res.status(400).json({ error: 'Only URL-based content can have its URL edited' })
  }

  let finalUrl = body.data.url
  const updatedDuration = body.data.slideDuration ?? content.slideDuration ?? 5

  if (content.type === 'SLIDES_URL') {
    const targetUrl = finalUrl || content.url
    if (targetUrl) {
      const match = targetUrl.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/)
      if (match) {
        finalUrl = `https://docs.google.com/presentation/d/${match[1]}/embed?start=true&loop=true&delayms=${updatedDuration * 1000}`
      }
    }
  }

  const updated = await prisma.content.update({
    where: { id: content.id },
    data: {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(finalUrl !== undefined ? { url: finalUrl } : {}),
      ...(body.data.muted !== undefined ? { muted: body.data.muted } : {}),
      ...(body.data.scale !== undefined ? { scale: body.data.scale } : {}),
      ...(body.data.slideDuration !== undefined ? { slideDuration: body.data.slideDuration } : {}),
      ...(body.data.validFrom !== undefined ? { validFrom: body.data.validFrom ? new Date(body.data.validFrom) : null } : {}),
      ...(body.data.validUntil !== undefined ? { validUntil: body.data.validUntil ? new Date(body.data.validUntil) : null } : {}),
    },
  })

  // If the Slides URL or slideDuration is updated, trigger a sync to render/update the slides
  if (content.type === 'SLIDES_URL' && (finalUrl || body.data.slideDuration !== undefined)) {
    try {
      await syncGoogleSlides(content.id)
    } catch (e: any) {
      console.warn('Sync on Slides URL/duration edit failed:', e.message)
    }
  }

  res.json(updated)
})

// POST /api/content/:id/sync — manually trigger Google Slides sync
router.post('/:id/sync', requireRole('CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const content = await prisma.content.findUnique({ where: { id: req.params.id } })
  if (!content || !teamGuard(content.teamId, req)) return res.status(404).json({ error: 'Not found' })
  if (content.type !== 'SLIDES_URL') return res.status(400).json({ error: 'Only Google Slides content can be synced' })

  try {
    const result = await syncGoogleSlides(content.id)
    const fresh = await prisma.content.findUnique({
      where: { id: content.id },
      include: { slideImages: true }
    })
    res.json({ success: true, updated: result.updated, content: fresh })
  } catch (err: any) {
    res.status(500).json({ error: `Sync failed: ${err.message}` })
  }
})

// DELETE /api/content/:id
router.delete('/:id', requireRole('TEAM_ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res) => {
  const content = await prisma.content.findUnique({ where: { id: req.params.id } })
  if (!content || !teamGuard(content.teamId, req)) return res.status(404).json({ error: 'Not found' })

  // Find playlists that reference this content so we can report + clean up
  const refs = await prisma.playlistItem.findMany({
    where: { contentId: content.id },
    select: { playlistId: true },
  })
  const playlistIds = [...new Set(refs.map(r => r.playlistId))]

  // Remove from any playlists first (FK would otherwise block deletion)
  await prisma.playlistItem.deleteMany({ where: { contentId: content.id } })

  // Delete the physical parent file if it exists
  if (content.filePath) {
    const fullPath = path.join(MEDIA_PATH, content.filePath)
    fs.rm(fullPath, { force: true }, () => {})
  }

  // Delete physical child slide image files and their parent directories if any
  const slideImages = await prisma.slideImage.findMany({
    where: { contentId: content.id }
  })
  for (const slide of slideImages) {
    const fullPath = path.join(MEDIA_PATH, slide.filePath)
    fs.rm(fullPath, { force: true }, () => {})
  }

  // If slides folder was created, clean up parent directory of slides
  if (slideImages.length > 0) {
    const firstSlidePath = path.join(MEDIA_PATH, slideImages[0].filePath)
    const parentDir = path.dirname(firstSlidePath)
    setTimeout(() => {
      try {
        if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
          fs.rmSync(parentDir, { recursive: true, force: true })
        }
      } catch (e) {}
    }, 1000)
  }

  await prisma.content.delete({ where: { id: content.id } })
  res.json({ ok: true, removedFromPlaylists: playlistIds.length })
})

export default router
