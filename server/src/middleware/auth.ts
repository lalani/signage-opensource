import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface AuthRequest extends Request {
  user?: { id: string; role: string; teamId: string | null }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' })
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as any
    let teamId = payload.teamId
    let activeTeamHeader: any = undefined
    if (payload.role === 'SUPER_ADMIN') {
      activeTeamHeader = req.headers['x-active-team-id'] || req.query.activeTeamId
      if (typeof activeTeamHeader === 'string') {
        teamId = activeTeamHeader || null
      } else {
        teamId = null
      }
    }
    req.user = { id: payload.sub, role: payload.role, teamId }
    console.log('[Auth Debug]', {
      role: payload.role,
      tokenTeamId: payload.teamId,
      activeTeamHeader,
      resolvedTeamId: teamId
    })
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}
