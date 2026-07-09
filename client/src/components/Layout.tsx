import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/store'
import api from '../lib/api'

const NAV = [
  { to: '/dashboard',   label: 'Dashboard'   },
  { to: '/devices',     label: 'Devices'     },
  { to: '/playlists',   label: 'Playlists'   },
  { to: '/content',     label: 'Content'     },
  { to: '/schedules',   label: 'Schedules'   },
  { to: '/widgets',     label: 'Widgets'     },
  { to: '/users',       label: 'Users'       },
  { to: '/grids',       label: 'Grids'       },
  { to: '/kiosk-setup', label: 'Kiosk Setup' },
  { to: '/guide',       label: 'User Guide'  },
  { to: '/system',      label: 'System Admin' },
]

const ICONS: Record<string, React.FC<{className?: string}>> = {
  '/dashboard': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  ),
  '/devices': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <path d="M8 21h8M12 17v4" strokeLinecap="round"/>
    </svg>
  ),
  '/playlists': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round"/>
    </svg>
  ),
  '/content': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>
      <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  '/schedules': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round"/>
      <circle cx="12" cy="16" r="2" fill="currentColor" stroke="none"/>
    </svg>
  ),
  '/users': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round"/>
    </svg>
  ),
  '/settings': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  '/kiosk-setup': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  '/grids': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  '/guide': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  '/widgets': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l-1.813-5.096L2.1 14.1l5.087-.817L9 8.25l1.813 5.033 5.087.817-5.087.804zm6.938-9.988l-.938 2.588-.938-2.588-2.587-.937 2.587-.938.938-2.588.938 2.588 2.587.938-2.587.937zM21 12l-.469 1.294-.469-1.294-1.294-.469 1.294-.469.469-1.294.469 1.294 1.294.469-1.294.469z" />
    </svg>
  ),
  '/system': ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
    </svg>
  ),
}

const LogoutIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"
      strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function Layout() {
  const { user, logout, activeTeamId, setActiveTeamId } = useAuth()
  const location = useLocation()
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  const team = user?.team as any
  let trialDaysLeft = 0
  let isTrialExpired = false
  if (team && !team.isPremium) {
    const created = new Date(team.createdAt)
    const expiry = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000)
    const now = new Date()
    const diffTime = expiry.getTime() - now.getTime()
    trialDaysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    isTrialExpired = diffTime <= 0
  }
  const [teams, setTeams] = useState<{ id: string; name: string; logoPath: string | null; isPremium?: boolean }[]>([])

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      api.get('/team').then(({ data }) => {
        setTeams(data)
      }).catch(err => {
        console.error('Failed to fetch teams:', err)
      })
    }
  }, [user])

  const activeTeam = teams.find(t => t.id === activeTeamId)
  const displayLogo = activeTeam ? activeTeam.logoPath : user?.team?.logoPath
  const isPremium = activeTeam ? activeTeam.isPremium : !!user?.team?.isPremium

  const filteredNav = NAV.filter(item => {
    if (item.to === '/grids') {
      return isPremium && (user?.role === 'TEAM_ADMIN' || user?.role === 'SUPER_ADMIN')
    }
    if (item.to === '/users' || item.to === '/schedules' || item.to === '/kiosk-setup') {
      return user?.role === 'TEAM_ADMIN' || user?.role === 'SUPER_ADMIN'
    }
    if (item.to === '/playlists' || item.to === '/content') {
      return user?.role === 'CONTENT_CREATOR' || user?.role === 'TEAM_ADMIN' || user?.role === 'SUPER_ADMIN'
    }
    if (item.to === '/system') {
      return user?.role === 'SUPER_ADMIN'
    }
    return true
  })

  const showSettings = user?.role === 'TEAM_ADMIN' || user?.role === 'SUPER_ADMIN'
  const navItems = showSettings ? [...filteredNav, { to: '/settings', label: 'Settings' }] : filteredNav

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-base">

      {/* ── Desktop sidebar (md and up) ── */}
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col bg-surface border-r border-border">
        <div className="h-14 flex items-center px-5 border-b border-border gap-3">
          <div className="w-7 h-7 rounded-lg bg-teal-glow border border-teal/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {displayLogo ? (
              <img src={`/media/${displayLogo}`} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-teal text-sm font-bold font-mono">S</span>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-xs tracking-tight text-txt-primary leading-none">Signage</span>
            <span className="text-[9px] text-txt-muted leading-none mt-0.5">by TableView Media</span>
          </div>
        </div>

        {user?.role === 'SUPER_ADMIN' && (
          <div className="px-4 py-3 border-b border-border space-y-1.5 bg-card/25">
            <label className="text-[10px] uppercase font-bold tracking-wider text-txt-secondary">
              Active Organization
            </label>
            <select
              value={activeTeamId || ''}
              onChange={(e) => {
                const val = e.target.value;
                setActiveTeamId(val ? val : null);
                window.location.reload();
              }}
              className="bg-card border border-border text-txt-primary text-xs rounded-lg px-2.5 py-1.5 w-full focus:outline-none focus:border-teal transition-colors"
            >
              <option value="">All Organizations</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, label }) => {
            const Icon = ICONS[to]
            return (
              <NavLink key={to} to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-teal-glow text-teal font-medium'
                      : 'text-txt-secondary hover:text-txt-primary hover:bg-border'
                  }`
                }>
                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                {label}
              </NavLink>
            )
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-txt-secondary">
                {user?.name?.[0]?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate text-txt-primary">{user?.name}</p>
              <p className="text-[10px] text-txt-muted truncate">{user?.role?.replace(/_/g, ' ')}</p>
            </div>
            <button onClick={logout} title="Sign out"
              className="text-txt-muted hover:text-coral transition-colors flex-shrink-0">
              <LogoutIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar (below md) ── */}
      <header className="md:hidden flex flex-col border-b border-border bg-surface flex-shrink-0">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-glow border border-teal/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {displayLogo ? (
                <img src={`/media/${displayLogo}`} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-teal text-sm font-bold font-mono">S</span>
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-sm tracking-tight text-txt-primary leading-none">Signage</span>
              <span className="text-[10px] text-txt-muted leading-none mt-0.5">by TableView Media</span>
            </div>
          </div>
          <button onClick={logout} title="Sign out"
            className="text-txt-muted hover:text-coral transition-colors p-1 -mr-1">
            <LogoutIcon className="w-5 h-5" />
          </button>
        </div>
        {user?.role === 'SUPER_ADMIN' && (
          <div className="px-4 pb-3 flex items-center gap-2 border-t border-border/20 pt-2 bg-card/10">
            <label className="text-[10px] uppercase font-bold tracking-wider text-txt-secondary whitespace-nowrap">
              Org:
            </label>
            <select
              value={activeTeamId || ''}
              onChange={(e) => {
                const val = e.target.value;
                setActiveTeamId(val ? val : null);
                window.location.reload();
              }}
              className="bg-card border border-border text-txt-primary text-xs rounded-lg px-2.5 py-1.5 w-full focus:outline-none focus:border-teal transition-colors"
            >
              <option value="">All Organizations</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col overflow-y-auto pb-16 md:pb-0">
        <div className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
          {team && !team.isPremium && (
            <div className={`mb-6 p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm ${
              isTrialExpired 
                ? 'bg-coral-glow/10 border-coral/20 text-coral' 
                : 'bg-amber-glow/10 border-amber/20 text-amber'
            }`}>
              <div className="flex items-center gap-3">
                <span className="text-xl">{isTrialExpired ? '🔴' : '⏳'}</span>
                <div>
                  <h4 className="font-semibold text-sm text-txt-primary">
                    {isTrialExpired ? 'Trial Expired' : 'Trial Active'}
                  </h4>
                  <p className="text-xs text-txt-secondary mt-0.5">
                    {isTrialExpired 
                      ? 'Your 30-day trial has expired. All media screens are currently deactivated.' 
                      : `You have ${trialDaysLeft} days remaining on your free trial. During the trial, you can register up to 1 screen.`
                    }
                  </p>
                </div>
              </div>
              {isTrialExpired && (
                <div className="text-xs font-semibold px-3 py-1.5 bg-coral-glow border border-coral/30 rounded-lg text-coral text-center">
                  Contact Super Admin to Upgrade
                </div>
              )}
            </div>
          )}
          <Outlet />
        </div>
        <footer className="py-4 border-t border-border/40 text-center text-[10px] text-txt-muted flex-shrink-0 flex items-center justify-center gap-2">
          <span>© 2026 TableView Media. All rights reserved.</span>
          <span>·</span>
          <NavLink to="/privacy" className="hover:text-teal transition-colors">Privacy Policy</NavLink>
        </footer>
      </main>

      {/* ── Mobile More Bottom Sheet ── */}
      {showMoreMenu && (
        <div 
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity animate-fade-in"
          onClick={() => setShowMoreMenu(false)}
        >
          <div 
            className="absolute bottom-0 left-0 right-0 bg-surface border-t border-border rounded-t-3xl p-6 pb-8 space-y-6 max-h-[85vh] overflow-y-auto shadow-2xl transition-transform"
            onClick={e => e.stopPropagation()}
          >
            {/* Grab handle */}
            <div className="w-12 h-1 bg-border rounded-full mx-auto -mt-2 mb-2" />
            
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs text-txt-secondary uppercase tracking-wider">More Views</h3>
              <button 
                onClick={() => setShowMoreMenu(false)}
                className="text-xs text-teal font-medium hover:underline"
              >
                Done
              </button>
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              {(() => {
                const primaryBottomDestinations = ['/dashboard', '/devices', '/playlists', '/content']
                const drawerItems = navItems.filter(item => !primaryBottomDestinations.includes(item.to))
                return drawerItems.map(({ to, label }) => {
                  const Icon = ICONS[to]
                  const isActive = location.pathname === to
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setShowMoreMenu(false)}
                      className={`flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border text-center transition-all ${
                        isActive 
                          ? 'bg-teal-glow border-teal/30 text-teal font-medium' 
                          : 'bg-card/45 border-border/40 text-txt-secondary hover:text-txt-primary hover:bg-border/30'
                      }`}
                    >
                      {Icon && <Icon className="w-5 h-5 flex-shrink-0" />}
                      <span className="text-[10px] leading-tight font-medium">{label}</span>
                    </NavLink>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile bottom tab bar (below md) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 flex items-stretch
        bg-surface border-t border-border z-40
        pb-[env(safe-area-inset-bottom)]">
        {(() => {
          const primaryBottomDestinations = ['/dashboard', '/devices', '/playlists', '/content']
          const bottomBarItems = navItems.filter(item => primaryBottomDestinations.includes(item.to))
          const isMoreActive = !primaryBottomDestinations.includes(location.pathname)

          return (
            <>
              {bottomBarItems.map(({ to, label }) => {
                const Icon = ICONS[to]
                return (
                  <NavLink key={to} to={to}
                    className={({ isActive }) =>
                      `flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] transition-colors ${
                        isActive ? 'text-teal' : 'text-txt-secondary'
                      }`
                    }>
                    {Icon && <Icon className="w-5 h-5" />}
                    {label}
                  </NavLink>
                )
              })}
              
              {/* More button to toggle bottom sheet */}
              <button
                onClick={() => setShowMoreMenu(true)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] transition-colors cursor-pointer ${
                  isMoreActive ? 'text-teal font-medium' : 'text-txt-secondary'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <circle cx="12" cy="12" r="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="5" r="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="19" r="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                More
              </button>
            </>
          )
        })()}
      </nav>
    </div>
  )
}
