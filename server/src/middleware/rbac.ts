import { Response, NextFunction } from 'express'
import { AuthRequest } from './auth'

const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  CONTENT_CREATOR: 1,
  TEAM_ADMIN: 2,
  SUPER_ADMIN: 3,
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRank = ROLE_RANK[req.user?.role ?? ''] ?? -1
    const minRank = Math.min(...roles.map((r) => ROLE_RANK[r] ?? 99))
    if (userRank >= minRank) return next()
    return res.status(403).json({ error: 'Insufficient permissions' })
  }
}

// Ensures a resource belongs to the user's team (skipped for SUPER_ADMIN)
export function teamGuard(resourceTeamId: string, req: AuthRequest): boolean {
  if (req.user?.role === 'SUPER_ADMIN') return true
  return req.user?.teamId === resourceTeamId
}
