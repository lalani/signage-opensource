import { create } from 'zustand'

export interface User {
  id: string
  name: string
  email: string
  role: string
  teamId: string | null
  team?: {
    name: string
    logoPath: string | null
    splashPath: string | null
    isPremium?: boolean
    maxStorage?: number
    maxDevices?: number
    maxIngressMonthly?: number
    maxEgressMonthly?: number
    currentIngressMonthly?: number
    currentEgressMonthly?: number
    billingCycleAnchor?: string
    createdAt?: string
    storageUsed?: number
    devicesCount?: number
  } | null
}

interface AuthStore {
  user: User | null
  loading: boolean
  activeTeamId: string | null
  setUser: (u: User | null) => void
  setLoading: (loading: boolean) => void
  setActiveTeamId: (id: string | null) => void
  logout: () => void
}

export const useAuth = create<AuthStore>((set) => ({
  user: null,
  loading: true,
  activeTeamId: localStorage.getItem('active_team_id'),
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setActiveTeamId: (id) => {
    if (id) {
      localStorage.setItem('active_team_id', id)
    } else {
      localStorage.removeItem('active_team_id')
    }
    set({ activeTeamId: id })
  },
  logout: () => {
    localStorage.clear()
    set({ user: null, activeTeamId: null })
    window.location.href = '/login'
  },
}))
