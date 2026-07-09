import { isTeamExpired, timeInWindow } from './scheduler'

describe('scheduler helper tests', () => {
  describe('timeInWindow', () => {
    it('should validate standard daytime window', () => {
      expect(timeInWindow('12:00', '09:00', '17:00')).toBe(true)
      expect(timeInWindow('08:59', '09:00', '17:00')).toBe(false)
      expect(timeInWindow('17:00', '09:00', '17:00')).toBe(false)
      expect(timeInWindow('18:00', '09:00', '17:00')).toBe(false)
    })

    it('should validate overnight window crossing midnight', () => {
      expect(timeInWindow('23:00', '22:00', '06:00')).toBe(true)
      expect(timeInWindow('02:00', '22:00', '06:00')).toBe(true)
      expect(timeInWindow('21:59', '22:00', '06:00')).toBe(false)
      expect(timeInWindow('06:00', '22:00', '06:00')).toBe(false)
      expect(timeInWindow('12:00', '22:00', '06:00')).toBe(false)
    })
  })

  describe('isTeamExpired', () => {
    it('should not expire premium teams', () => {
      const premiumTeam = {
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        isPremium: true
      }
      expect(isTeamExpired(premiumTeam)).toBe(false)
    })

    it('should not expire standard teams inside 30-day trial', () => {
      const activeTeam = {
        createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        isPremium: false
      }
      expect(isTeamExpired(activeTeam)).toBe(false)
    })

    it('should expire standard teams older than 30 days', () => {
      const expiredTeam = {
        createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        isPremium: false
      }
      expect(isTeamExpired(expiredTeam)).toBe(true)
    })
  })
})
