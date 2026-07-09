import { resetMonthlyLimits } from './scheduler'
import prisma from '../prisma'

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    team: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}))

describe('Organization Limit Reset Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should fetch teams past their anchor date and reset their bandwidth limits', async () => {
    const mockTeams = [
      {
        id: 'team-1',
        name: 'Acme Corp',
        billingCycleAnchor: new Date('2026-07-01T00:00:00.000Z'),
        currentIngressMonthly: 5000,
        currentEgressMonthly: 12000,
      },
      {
        id: 'team-2',
        name: 'Stark Industries',
        billingCycleAnchor: new Date('2026-07-05T00:00:00.000Z'),
        currentIngressMonthly: 15000,
        currentEgressMonthly: 45000,
      },
    ]

    ;(prisma.team.findMany as jest.Mock).mockResolvedValue(mockTeams)
    ;(prisma.team.update as jest.Mock).mockResolvedValue({})

    await resetMonthlyLimits()

    expect(prisma.team.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.team.update).toHaveBeenCalledTimes(2)

    const firstCallArgs = (prisma.team.update as jest.Mock).mock.calls[0][0]
    expect(firstCallArgs.where).toEqual({ id: 'team-1' })
    expect(firstCallArgs.data.currentIngressMonthly).toBe(0)
    expect(firstCallArgs.data.currentEgressMonthly).toBe(0)

    const expectedNewAnchor = new Date('2026-08-01T00:00:00.000Z')
    expect(firstCallArgs.data.billingCycleAnchor.getTime()).toBe(expectedNewAnchor.getTime())

    const secondCallArgs = (prisma.team.update as jest.Mock).mock.calls[1][0]
    expect(secondCallArgs.where).toEqual({ id: 'team-2' })
    expect(secondCallArgs.data.currentIngressMonthly).toBe(0)
    expect(secondCallArgs.data.currentEgressMonthly).toBe(0)
    const expectedNewAnchor2 = new Date('2026-08-05T00:00:00.000Z')
    expect(secondCallArgs.data.billingCycleAnchor.getTime()).toBe(expectedNewAnchor2.getTime())
  })

  it('should not update anything if no teams are past their billing cycle anchor', async () => {
    ;(prisma.team.findMany as jest.Mock).mockResolvedValue([])

    await resetMonthlyLimits()

    expect(prisma.team.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.team.update).not.toHaveBeenCalled()
  })
})
