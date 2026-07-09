import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuth } from '../lib/store'

interface Device {
  id: string; name: string; location?: string; online: boolean
  screenWidth?: number; screenHeight?: number; lastSeen?: string; ipAddress?: string
  currentPlaylist?: { name: string }
  screenshotUrl?: string; screenshotAt?: string
  cpuUsage?: number; cpuTemp?: number; memUsage?: number; diskUsage?: number; uptime?: number
}

interface Content {
  id: string; fileSize?: number
}

export default function Dashboard() {
  const qc = useQueryClient()
  const { user, activeTeamId } = useAuth()
  
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)

  // 1. Fetch devices list
  const { data: devices = [], isLoading: isLoadingDevices } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn:  () => api.get('/devices').then(r => r.data),
    refetchInterval: 10_000,
  })

  // 2. Fetch playlists list
  const { data: playlists = [] } = useQuery<any[]>({
    queryKey: ['playlists'],
    queryFn: () => api.get('/playlists').then(r => r.data),
  })

  // 3. Fetch device groups list
  const { data: groups = [] } = useQuery<any[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then(r => r.data),
  })

  // 4. Fetch content list for storage usage calculation
  const { data: content = [] } = useQuery<Content[]>({
    queryKey: ['content'],
    queryFn: () => api.get('/content').then(r => r.data),
  })

  // 5. Fetch all teams (SUPER_ADMIN only) to calculate storage when "All Organizations" is selected
  const { data: teams = [] } = useQuery<any[]>({
    queryKey: ['teams'],
    queryFn: () => api.get('/team').then(r => r.data),
    enabled: user?.role === 'SUPER_ADMIN',
  })

  const online = devices.filter(d => d.online).length
  const totalStorageUsed = content.reduce((acc, item) => acc + (item.fileSize || 0), 0)
  
  let maxStorage = user?.team?.maxStorage || 5368709120 // default 5 GB in bytes
  let storageUsed = totalStorageUsed

  if (user?.role === 'SUPER_ADMIN' && !activeTeamId && teams.length > 0) {
    maxStorage = teams.reduce((acc, t) => acc + (t.maxStorage || 0), 0)
    storageUsed = teams.reduce((acc, t) => acc + (t.storageUsed || 0), 0)
  }

  // Ensure safe fallback if maxStorage is configured as 0
  maxStorage = maxStorage || 5368709120

  const onlineRatio = devices.length > 0 ? online / devices.length : 0
  const storageRatio = maxStorage > 0 ? storageUsed / maxStorage : 0

  const preview = devices.find(d => d.id === previewId)

  async function cmd(id: string, command: string, label: string) {
    try {
      await api.post(`/devices/${id}/cmd`, { command })
      toast.success(`${label} sent`)
      if (command === 'cmd:screenshot') {
        setTimeout(() => qc.invalidateQueries({ queryKey: ['devices'] }), 3000)
      }
    } catch { toast.error('Device unreachable') }
  }

  function formatUptime(sec: number | undefined | null) {
    if (sec === undefined || sec === null) return '—'
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Dashboard</h1>
        <p className="text-txt-secondary text-sm mt-1">Live metrics control center · refreshes every 10s</p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Screens */}
        <div className="bg-card border border-border/60 hover:border-teal/30 hover:shadow-teal-glow/[0.02] rounded-xl p-5 shadow-lg relative overflow-hidden transition-all duration-300 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-txt-secondary uppercase tracking-wider">Active Screens</p>
              <h3 className="text-2xl font-bold mt-1 text-txt-primary">
                {online} <span className="text-sm font-normal text-txt-secondary">/ {devices.length}</span>
              </h3>
            </div>
            <div className="p-3 bg-teal/10 rounded-lg text-teal transition-transform group-hover:scale-110">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full bg-border/50 h-1.5 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  onlineRatio === 1 ? 'bg-teal' : onlineRatio > 0.5 ? 'bg-amber' : 'bg-coral'
                }`}
                style={{ width: `${devices.length > 0 ? (online / devices.length * 100) : 0}%` }}
              />
            </div>
            <p className="text-[10px] text-txt-secondary mt-1.5 font-semibold font-mono">
              {devices.length > 0 ? `${(online / devices.length * 100).toFixed(0)}% online` : 'No devices connected'}
            </p>
          </div>
        </div>

        {/* Card 2: Storage Quota */}
        <div className="bg-card border border-border/60 hover:border-teal/30 hover:shadow-teal-glow/[0.02] rounded-xl p-5 shadow-lg relative overflow-hidden transition-all duration-300 group">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-txt-secondary uppercase tracking-wider">Storage Quota</p>
              <h3 className="text-xl font-bold mt-1 text-txt-primary truncate" title={`${formatBytes(storageUsed)} / ${formatBytes(maxStorage)}`}>
                {formatBytes(storageUsed)} <span className="text-xs font-normal text-txt-secondary">/ {formatBytes(maxStorage)}</span>
              </h3>
            </div>
            <div className="p-3 bg-amber/10 rounded-lg text-amber transition-transform group-hover:scale-110 flex-shrink-0">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.58 4 8 4s8-1.79 8-4M4 7c0-2.21 3.58-4 8-4s8 1.79 8 4m0 5c0 2.21-3.58 4-8 4s-8-1.79-8-4" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full bg-border/50 h-1.5 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  storageRatio > 0.9 ? 'bg-coral' : storageRatio > 0.75 ? 'bg-amber' : 'bg-teal'
                }`}
                style={{ width: `${Math.min(100, storageRatio * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-txt-secondary mt-1.5 font-semibold font-mono">
              {(storageRatio * 100).toFixed(1)}% space consumed
            </p>
          </div>
        </div>

        {/* Card 3: Active Playlists */}
        <div className="bg-card border border-border/60 hover:border-teal/30 hover:shadow-teal-glow/[0.02] rounded-xl p-5 shadow-lg relative overflow-hidden transition-all duration-300 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-txt-secondary uppercase tracking-wider">Playlists</p>
              <h3 className="text-2xl font-bold mt-1 text-txt-primary">
                {playlists.length}
              </h3>
            </div>
            <div className="p-3 bg-coral/10 rounded-lg text-coral transition-transform group-hover:scale-110">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-txt-secondary font-semibold font-mono uppercase tracking-wide">
              Ready to deploy
            </p>
          </div>
        </div>

        {/* Card 4: Screen Groups */}
        <div className="bg-card border border-border/60 hover:border-teal/30 hover:shadow-teal-glow/[0.02] rounded-xl p-5 shadow-lg relative overflow-hidden transition-all duration-300 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-txt-secondary uppercase tracking-wider">Device Groups</p>
              <h3 className="text-2xl font-bold mt-1 text-txt-primary">
                {groups.length}
              </h3>
            </div>
            <div className="p-3 bg-teal/10 rounded-lg text-teal transition-transform group-hover:scale-110">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-txt-secondary font-semibold font-mono uppercase tracking-wide">
              Active Sync Matrices
            </p>
          </div>
        </div>
      </div>

      {/* Screen Monitor Control Panel */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-txt-primary flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-teal animate-pulse-slow" />
          Live Screen Monitor
        </h2>

        {isLoadingDevices ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="bg-card border border-border h-64 rounded-xl animate-pulse" />)}
          </div>
        ) : devices.length === 0 ? (
          <div className="bg-card border border-border py-16 text-center text-txt-secondary text-sm rounded-xl">
            No devices registered — go to <span className="text-teal font-medium">Devices</span> to pair your first web player or Raspberry Pi.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {devices.map(d => {
              const isOnline = d.online
              return (
                <div 
                  key={d.id} 
                  className={`bg-card border rounded-xl p-4 flex flex-col justify-between gap-4 transition-all duration-300 ${
                    isOnline 
                      ? 'border-teal/30 hover:border-teal/50 hover:shadow-teal-glow/[0.01]' 
                      : 'border-coral/20 hover:border-coral/35'
                  }`}
                >
                  {/* Card Header */}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-txt-primary truncate" title={d.name}>{d.name}</p>
                        {d.location ? (
                          <p className="text-xs text-txt-secondary truncate mt-0.5" title={d.location}>
                            📍 {d.location}
                          </p>
                        ) : (
                          <p className="text-xs text-txt-muted truncate mt-0.5">No location set</p>
                        )}
                      </div>
                      <span 
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold font-mono tracking-wide ${
                          isOnline 
                            ? 'text-teal bg-teal-glow border border-teal/20' 
                            : 'text-coral bg-coral-glow border border-coral/20'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-teal animate-pulse-slow' : 'bg-coral'}`} />
                        {isOnline ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </div>
                    
                    {/* Active Playlist Status */}
                    <div className="mt-3 bg-surface/50 border border-border/40 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-xs gap-2">
                      <span className="text-txt-secondary font-medium">Playlist</span>
                      <span className="font-mono text-teal font-semibold truncate max-w-[125px]" title={d.currentPlaylist?.name ?? 'No active playlist'}>
                        {d.currentPlaylist?.name ? `▶ ${d.currentPlaylist.name}` : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Hardware & Diagnostics */}
                  <div className="space-y-3">
                    {isOnline ? (
                      <>
                        {/* CPU Bar */}
                        <div>
                          <div className="flex justify-between text-[10px] font-mono text-txt-secondary mb-1">
                            <span>CPU</span>
                            <span className="font-semibold text-txt-primary">
                              {d.cpuUsage !== undefined && d.cpuUsage !== null ? `${d.cpuUsage.toFixed(0)}%` : '—'}
                              {d.cpuTemp !== undefined && d.cpuTemp !== null ? ` (${d.cpuTemp.toFixed(0)}°C)` : ''}
                            </span>
                          </div>
                          <div className="w-full bg-surface h-1 rounded-full overflow-hidden border border-border/30">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${
                                (d.cpuUsage || 0) > 80 ? 'bg-coral' : (d.cpuUsage || 0) > 50 ? 'bg-amber' : 'bg-teal'
                              }`}
                              style={{ width: `${d.cpuUsage || 0}%` }}
                            />
                          </div>
                        </div>

                        {/* RAM Bar */}
                        <div>
                          <div className="flex justify-between text-[10px] font-mono text-txt-secondary mb-1">
                            <span>RAM</span>
                            <span className="font-semibold text-txt-primary">
                              {d.memUsage !== undefined && d.memUsage !== null ? `${d.memUsage.toFixed(0)}%` : '—'}
                            </span>
                          </div>
                          <div className="w-full bg-surface h-1 rounded-full overflow-hidden border border-border/30">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${
                                (d.memUsage || 0) > 85 ? 'bg-coral' : (d.memUsage || 0) > 60 ? 'bg-amber' : 'bg-teal'
                              }`}
                              style={{ width: `${d.memUsage || 0}%` }}
                            />
                          </div>
                        </div>

                        {/* Disk Space Bar */}
                        <div>
                          <div className="flex justify-between text-[10px] font-mono text-txt-secondary mb-1">
                            <span>Disk Usage</span>
                            <span className="font-semibold text-txt-primary">
                              {d.diskUsage !== undefined && d.diskUsage !== null ? `${(100 - d.diskUsage).toFixed(0)}% free` : '—'}
                            </span>
                          </div>
                          <div className="w-full bg-surface h-1 rounded-full overflow-hidden border border-border/30">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${
                                (d.diskUsage || 0) > 90 ? 'bg-coral' : (d.diskUsage || 0) > 75 ? 'bg-amber' : 'bg-teal'
                              }`}
                              style={{ width: `${d.diskUsage || 0}%` }}
                            />
                          </div>
                        </div>

                        {/* Resolution & Uptime Footer */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/30 text-[9px] font-mono text-txt-secondary">
                          <div className="flex items-center gap-1">
                            <span>🖥️</span>
                            <span className="truncate">{d.screenWidth ? `${d.screenWidth}×${d.screenHeight}` : '—'}</span>
                          </div>
                          <div className="flex items-center gap-1 justify-end">
                            <span>⏱️</span>
                            <span className="truncate">{formatUptime(d.uptime)}</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="py-5 text-center border border-dashed border-border/50 rounded-lg text-txt-muted text-[11px] flex flex-col items-center justify-center gap-1 font-mono">
                        <span>Status offline</span>
                        <span>
                          Last active: {d.lastSeen ? formatDistanceToNow(new Date(d.lastSeen), { addSuffix: true }) : 'never'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Quick Action Footer */}
                  <div className="flex gap-1 pt-2 border-t border-border/40 mt-1">
                    <button 
                      disabled={!d.screenshotUrl}
                      onClick={() => d.screenshotUrl && setPreviewId(d.id)}
                      title={d.screenshotUrl ? "View last screenshot snapshot" : "No screens taken yet"}
                      className="flex-1 text-[11px] font-medium py-1.5 rounded bg-surface hover:bg-teal-glow hover:text-teal border border-border/60 hover:border-teal/30 text-txt-secondary transition-all duration-200 disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-txt-secondary disabled:hover:border-border/60"
                    >
                      📷 Screen
                    </button>
                    {isOnline && (
                      <>
                        <CmdBtn label="Logs" onClick={() => cmd(d.id, 'cmd:get_logs', 'Log request')} />
                        <CmdBtn label="Restart" onClick={() => cmd(d.id, 'cmd:restart', 'Restart')} />
                        <CmdBtn label="Reboot" onClick={() => cmd(d.id, 'cmd:reboot', 'Reboot')} />
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Screen Preview & Screenshot Refresher Modal */}
      {preview && (
        <div 
          className="fixed inset-0 z-50 bg-base/95 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => {
            if (!capturing) setPreviewId(null)
          }}
        >
          <div 
            className="max-w-4xl w-full bg-card border border-border rounded-xl p-5 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/60">
              <div>
                <h2 className="font-semibold text-base text-txt-primary flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-teal animate-pulse-slow" />
                  {preview.name}
                </h2>
                {preview.screenshotAt && (
                  <p className="text-xs text-txt-secondary mt-0.5">
                    Snapshot captured {formatDistanceToNow(new Date(preview.screenshotAt), { addSuffix: true })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {preview.online && (
                  <button 
                    disabled={capturing}
                    onClick={async () => {
                      setCapturing(true)
                      try {
                        await api.post(`/devices/${preview.id}/cmd`, { command: 'cmd:screenshot' })
                        toast.success('Screenshot request broadcasted')
                        // Wait 3.5s for the screenshot process to upload
                        await new Promise(resolve => setTimeout(resolve, 3500))
                        await qc.invalidateQueries({ queryKey: ['devices'] })
                        toast.success('Screenshot refreshed')
                      } catch {
                        toast.error('Device unreachable')
                      } finally {
                        setCapturing(false)
                      }
                    }} 
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal text-base font-semibold hover:bg-teal-dim transition-colors text-xs disabled:opacity-50"
                  >
                    {capturing ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-base" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Refreshing...</span>
                      </>
                    ) : (
                      '📸 Capture New Screenshot'
                    )}
                  </button>
                )}
                <button 
                  disabled={capturing}
                  onClick={() => setPreviewId(null)} 
                  className="btn-ghost text-xs border border-border/85 hover:bg-border px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  ✕ Close
                </button>
              </div>
            </div>
            
            {/* Modal Screen Preview Area */}
            <div className="relative aspect-video rounded-lg overflow-hidden bg-surface border border-border/50 flex items-center justify-center">
              {preview.screenshotUrl ? (
                <img
                  src={`${preview.screenshotUrl}?t=${preview.screenshotAt ? new Date(preview.screenshotAt).getTime() : 0}`}
                  alt="Live screenshot"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-txt-muted text-sm flex flex-col items-center gap-2">
                  <span>📷</span>
                  <span>No screenshots taken yet. Click Capture New Screenshot to pull one.</span>
                </div>
              )}
              {capturing && (
                <div className="absolute inset-0 bg-base/85 flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
                  <svg className="animate-spin h-8 w-8 text-teal" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-sm font-semibold text-txt-secondary">Instructing device to upload current view...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CmdBtn({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  return (
    <button 
      onClick={onClick} 
      title={title}
      className="flex-1 text-[11px] font-semibold py-1.5 rounded bg-surface hover:bg-teal-glow hover:text-teal border border-border/60 hover:border-teal/30 text-txt-secondary transition-all duration-200"
    >
      {label}
    </button>
  )
}

