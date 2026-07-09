import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { io } from 'socket.io-client'
import { useAuth } from '../lib/store'
import 'xterm/css/xterm.css'

interface Device {
  id: string; name: string; location?: string; registrationKey: string
  online: boolean; status: string
  screenWidth?: number; screenHeight?: number
  currentPlaylist?: { name: string }
  lastSeen?: string; ipAddress?: string
  agentVersion?: string
  screenshotUrl?: string; screenshotAt?: string
  cpuUsage?: number; cpuTemp?: number; memUsage?: number; diskUsage?: number; uptime?: number
  assignedUsers?: { id: string; name: string; email: string }[]
  teamId?: string
  orientation?: string
}

interface DeviceLog {
  id: string; level: string; message: string; createdAt: string
}

const LATEST_PLAYER_VERSION = '1.2.0'

export default function Devices() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd]     = useState(false)
  const [name,    setName]        = useState('')
  const [location, setLoc]        = useState('')
  const [logDevice,  setLogDevice]  = useState<Device | null>(null)
  const [ssDevice,   setSsDevice]   = useState<Device | null>(null)
  const [terminalDevice, setTerminalDevice] = useState<Device | null>(null)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [detailed, setDetailed]     = useState(false)
  const [liveMonitoring, setLiveMonitoring] = useState(false)

  const [addMode, setAddMode]       = useState<'pi' | 'web'>('pi')
  const [pairCode, setPairCode]     = useState('')
  const [targetTeamId, setTargetTeamId] = useState('')

  const [activeTab, setActiveTab] = useState<'screens' | 'groups'>('screens')
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selectedDevices, setSelectedDevices] = useState<string[]>([])
  const [editGroup, setEditGroup] = useState<any | null>(null)

  function formatUptime(sec: number | undefined | null) {
    if (sec === undefined || sec === null) return '—'
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  const { user: me } = useAuth()

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn:  () => api.get('/devices').then(r => r.data),
    refetchInterval: liveMonitoring ? 5_000 : 15_000,
  })

  // Fetch users for assignment dropdown
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['users'],
    queryFn:  () => api.get('/users').then(r => r.data),
    enabled: me?.role === 'TEAM_ADMIN' || me?.role === 'SUPER_ADMIN',
  })

  // Fetch organizations for moving devices (Super Admin only)
  const { data: orgs = [] } = useQuery<any[]>({
    queryKey: ['orgs'],
    queryFn:  () => api.get('/team').then(r => r.data),
    enabled: me?.role === 'SUPER_ADMIN',
  })

  const { data: groups = [] } = useQuery<any[]>({
    queryKey: ['groups'],
    queryFn:  () => api.get('/groups').then(r => r.data),
    refetchInterval: 15_000,
  })

  const { data: playlists = [] } = useQuery<any[]>({
    queryKey: ['playlists'],
    queryFn:  () => api.get('/playlists').then(r => r.data),
  })

  // Periodic screenshot requester for live monitoring
  useEffect(() => {
    if (!liveMonitoring || devices.length === 0) return

    const requestAllScreenshots = () => {
      devices.forEach(d => {
        if (d.online) {
          api.post(`/devices/${d.id}/cmd`, { command: 'cmd:screenshot' }).catch(() => {})
        }
      })
    }

    requestAllScreenshots()
    const interval = setInterval(requestAllScreenshots, 20000)
    return () => clearInterval(interval)
  }, [liveMonitoring, devices.length])

  const moveDevice = useMutation({
    mutationFn: ({ id, teamId }: { id: string; teamId: string }) =>
      api.patch(`/devices/${id}`, { teamId }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Device moved successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to move device')
    }
  })

  const updateAssignment = useMutation({
    mutationFn: ({ id, assignedUserIds }: { id: string; assignedUserIds: string[] }) =>
      api.patch(`/devices/${id}`, { assignedUserIds }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Assignment updated')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to update assignment')
    }
  })

  const updateDevice = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; location?: string; currentPlaylistId?: string | null; assignedUserIds?: string[]; teamId?: string; orientation?: string }) =>
      api.patch(`/devices/${id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Device settings updated')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to update device')
    }
  })



  const handleAssignUser = (d: Device, userId: string) => {
    const currentIds = d.assignedUsers?.map((u: any) => u.id) || []
    if (!currentIds.includes(userId)) {
      updateAssignment.mutate({ id: d.id, assignedUserIds: [...currentIds, userId] })
    }
  }

  const handleUnassignUser = (d: Device, userId: string) => {
    const currentIds = d.assignedUsers?.map((u: any) => u.id) || []
    updateAssignment.mutate({ id: d.id, assignedUserIds: currentIds.filter(id => id !== userId) })
  }

  // Fetch logs for the selected device
  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery<DeviceLog[]>({
    queryKey: ['device-logs', logDevice?.id],
    queryFn:  () => api.get(`/devices/${logDevice!.id}/logs`).then(r => r.data),
    enabled: !!logDevice,
  })

  const add = useMutation({
    mutationFn: (d: { name: string; location: string; teamId?: string }) => api.post('/devices', d).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      setShowAdd(false)
      setName('')
      setLoc('')
      setTargetTeamId('')
      toast.success('Device added successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to add device')
    }
  })

  const pairRegister = useMutation({
    mutationFn: (d: { code: string; name: string; location?: string; teamId?: string }) =>
      api.post('/devices/pair/register', d).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      setShowAdd(false)
      setName('')
      setLoc('')
      setPairCode('')
      setTargetTeamId('')
      setAddMode('pi')
      toast.success('Web Player registered successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to register Web Player')
    }
  })

  const createGroup = useMutation({
    mutationFn: (g: { name: string; deviceIds: string[]; teamId?: string }) => api.post('/groups', g).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setShowAddGroup(false)
      setGroupName('')
      setSelectedDevices([])
      setTargetTeamId('')
      toast.success('Device group created')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to create group')
    }
  })

  const updateGroup = useMutation({
    mutationFn: ({ id, name, deviceIds }: { id: string; name?: string; deviceIds?: string[] }) =>
      api.patch(`/groups/${id}`, { name, deviceIds }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setEditGroup(null)
      toast.success('Group updated')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to update group')
    }
  })

  const deleteGroup = useMutation({
    mutationFn: (id: string) => api.delete(`/groups/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      toast.success('Group deleted')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to delete group')
    }
  })

  const deployPlaylistToGroup = useMutation({
    mutationFn: ({ id, currentPlaylistId }: { id: string; currentPlaylistId: string | null }) =>
      api.patch(`/groups/${id}`, { currentPlaylistId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Playlist deployed to group')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to deploy playlist')
    }
  })

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/devices/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); toast.success('Device removed') },
  })

  async function cmd(device: Device, command: string) {
    setRequesting(device.id + command)
    try {
      await api.post(`/devices/${device.id}/cmd`, { command })

      if (command === 'cmd:get_logs') {
        toast.success('Log request sent — opening viewer…')
        setLogDevice(device)
        // Give the Pi a moment to respond, then fetch from DB
        setTimeout(() => refetchLogs(), 2500)
      } else if (command === 'cmd:screenshot') {
        toast.success('Screenshot requested — refreshing in 3s…')
        setTimeout(async () => {
          await qc.invalidateQueries({ queryKey: ['devices'] })
          // Re-fetch device to get updated screenshot URL
          const { data } = await api.get('/devices')
          const updated = data.find((d: Device) => d.id === device.id)
          if (updated) setSsDevice(updated)
        }, 3000)
        setSsDevice(device)
      } else {
        toast.success(`${command.replace('cmd:', '')} sent`)
      }
    } catch { toast.error('Device unreachable') }
    setRequesting(null)
  }

  const logLevelColor: Record<string, string> = {
    info:  'text-teal',
    warn:  'text-amber',
    error: 'text-coral',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-4 flex-wrap">
          <h1 className="text-xl font-semibold">Devices</h1>
          <button onClick={() => setDetailed(!detailed)} className="text-xs text-txt-muted hover:text-teal transition-colors">
            {detailed ? '📊 Hide Detailed Stats' : '📊 Show Detailed Stats'}
          </button>
          {activeTab === 'screens' && (
            <button
              onClick={() => setLiveMonitoring(!liveMonitoring)}
              className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-all ${
                liveMonitoring
                  ? 'bg-teal/15 border-teal/30 text-teal animate-pulse font-semibold'
                  : 'border-border text-txt-muted hover:text-txt-primary hover:border-border/80'
              }`}
            >
              🎥 {liveMonitoring ? 'Live Monitor (On)' : 'Live Monitor (Off)'}
            </button>
          )}
        </div>
        {activeTab === 'screens' ? (
          <button onClick={() => setShowAdd(true)} className="btn-primary">+ Add Screen</button>
        ) : (
          <button onClick={() => {
            setSelectedDevices([])
            setGroupName('')
            setShowAddGroup(true)
          }} className="btn-primary">+ Add Group</button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/80">
        <button
          onClick={() => setActiveTab('screens')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'screens'
              ? 'border-teal text-teal'
              : 'border-transparent text-txt-muted hover:text-txt-primary'
          }`}
        >
          Screens ({devices.length})
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'groups'
              ? 'border-teal text-teal'
              : 'border-transparent text-txt-muted hover:text-txt-primary'
          }`}
        >
          Groups ({groups.length})
        </button>
      </div>

      {showAdd && (
        <div className="card max-w-md space-y-4">
          <h3 className="font-semibold text-sm">Add New Device</h3>
          
          {/* Segment Selector */}
          <div className="flex bg-surface p-1 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setAddMode('pi')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                addMode === 'pi'
                  ? 'bg-card text-teal shadow border border-border/80'
                  : 'text-txt-secondary hover:text-txt-primary'
              }`}
            >
              Raspberry Pi
            </button>
            <button
              type="button"
              onClick={() => setAddMode('web')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                addMode === 'web'
                  ? 'bg-card text-teal shadow border border-border/80'
                  : 'text-txt-secondary hover:text-txt-primary'
              }`}
            >
              Web Player (Firestick)
            </button>
          </div>

          <div className="space-y-3">
            {addMode === 'web' && (
              <input
                className="input font-mono uppercase tracking-widest text-center text-lg focus:border-teal"
                placeholder="Pairing Code (e.g. ABCDEF)"
                value={pairCode}
                onChange={e => setPairCode(e.target.value.toUpperCase().slice(0, 6))}
                maxLength={6}
                autoFocus
              />
            )}
            
            <input
              className="input"
              placeholder="Display name (e.g. Lobby TV)"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus={addMode === 'pi'}
            />
            
            <input
              className="input"
              placeholder="Location (optional, e.g. Front Entrance)"
              value={location}
              onChange={e => setLoc(e.target.value)}
            />

            {me?.role === 'SUPER_ADMIN' && orgs.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] text-txt-secondary font-semibold uppercase tracking-wider">Target Organization</label>
                <select
                  className="input"
                  value={targetTeamId}
                  onChange={e => setTargetTeamId(e.target.value)}
                >
                  <option value="">Select Organization (Required)</option>
                  {orgs.map((org: any) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2 border-t border-border/40">
            {addMode === 'pi' ? (
              <button
                onClick={() => add.mutate({
                  name,
                  location,
                  teamId: me?.role === 'SUPER_ADMIN' ? targetTeamId : undefined
                })}
                disabled={!name || add.isPending || (me?.role === 'SUPER_ADMIN' && !targetTeamId)}
                className="btn-primary"
              >
                Create
              </button>
            ) : (
              <button
                onClick={() => pairRegister.mutate({
                  code: pairCode,
                  name,
                  location,
                  teamId: me?.role === 'SUPER_ADMIN' ? targetTeamId : undefined
                })}
                disabled={!name || pairCode.length !== 6 || pairRegister.isPending || (me?.role === 'SUPER_ADMIN' && !targetTeamId)}
                className="btn-primary"
              >
                Pair & Register
              </button>
            )}
            <button
              onClick={() => {
                setShowAdd(false)
                setName('')
                setLoc('')
                setPairCode('')
                setTargetTeamId('')
                setAddMode('pi')
              }}
              className="btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeTab === 'screens' && (
        <div className="space-y-2">
          {devices.map(d => (
            <div key={d.id} className="card">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${d.online ? 'bg-teal animate-pulse-slow' : 'bg-coral'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium text-sm">{d.name}</span>
                      {d.location && <span className="text-xs text-txt-muted">{d.location}</span>}
                      {d.screenWidth && <span className="text-xs font-mono text-txt-muted">{d.screenWidth}×{d.screenHeight}</span>}
                      {d.orientation && d.orientation !== 'LANDSCAPE' && (
                        <span className="text-[10px] text-teal font-medium bg-teal-glow border border-teal/15 px-1.5 py-0.5 rounded font-sans uppercase tracking-wider">
                          🔄 {d.orientation.replace('_', ' ')}
                        </span>
                      )}
                      {detailed && d.ipAddress && <span className="text-xs font-mono text-txt-muted">{d.ipAddress}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-txt-muted font-mono">
                      <span>key: <span className="text-txt-secondary select-all">{d.registrationKey}</span></span>
                      {d.currentPlaylist && <span>▶ {d.currentPlaylist.name}</span>}
                      {d.lastSeen && <span>seen {formatDistanceToNow(new Date(d.lastSeen), { addSuffix: true })}</span>}
                      {d.agentVersion !== LATEST_PLAYER_VERSION ? (
                        <span className="inline-flex items-center gap-1 bg-amber-glow text-amber text-[10px] px-1.5 py-0.5 rounded font-medium border border-amber/15 font-sans">
                          ⚠️ Out of Date ({d.agentVersion || '1.0.0'})
                          {d.online && (
                            <button
                              onClick={() => cmd(d, 'cmd:restart')}
                              className="ml-1.5 underline hover:text-white transition-colors cursor-pointer"
                              title="Force reload screen to pull latest updates"
                            >
                              Update
                            </button>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] bg-teal-glow text-teal px-1.5 py-0.5 rounded border border-teal/15 font-medium font-sans">
                          v{d.agentVersion} (Latest)
                        </span>
                      )}
                      {detailed && d.online && d.cpuUsage !== undefined && d.cpuUsage !== null && (
                        <span>cpu: <span className="text-txt-secondary">{d.cpuUsage.toFixed(0)}%</span>{d.cpuTemp !== null && d.cpuTemp !== undefined && <span className="text-txt-secondary"> ({d.cpuTemp.toFixed(0)}°C)</span>}</span>
                      )}
                      {detailed && d.online && d.memUsage !== undefined && d.memUsage !== null && (
                        <span>mem: <span className="text-txt-secondary">{d.memUsage.toFixed(0)}%</span></span>
                      )}
                      {detailed && d.online && d.diskUsage !== undefined && d.diskUsage !== null && (
                        <span>disk: <span className="text-txt-secondary">{(100 - d.diskUsage).toFixed(0)}% free</span></span>
                      )}
                      {detailed && d.online && d.uptime !== undefined && d.uptime !== null && (
                        <span>up: <span className="text-txt-secondary">{formatUptime(d.uptime)}</span></span>
                      )}
                      {(me?.role === 'TEAM_ADMIN' || me?.role === 'SUPER_ADMIN') ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-txt-muted">👤 Restricted to:</span>
                          {d.assignedUsers && d.assignedUsers.map(u => (
                            <span key={u.id} className="inline-flex items-center gap-0.5 bg-teal-glow text-teal text-[10px] px-1.5 py-0.5 rounded font-medium border border-teal/15">
                              {u.name}
                              <button
                                onClick={() => handleUnassignUser(d, u.id)}
                                className="hover:text-coral transition-colors font-bold ml-1 text-xs"
                                title="Remove restriction"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {(!d.assignedUsers || d.assignedUsers.length === 0) && (
                            <span className="text-[10px] text-txt-secondary font-medium mr-1 bg-border/20 px-1.5 py-0.5 rounded border border-border/10">All Organization Users</span>
                          )}
                          {users.filter(u => !d.assignedUsers?.some((au: any) => au.id === u.id)).length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleAssignUser(d, e.target.value)
                                }
                              }}
                              className="bg-card border border-border text-txt-secondary rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-teal transition-colors cursor-pointer"
                            >
                              <option value="">+ Restrict to user</option>
                              {users
                                .filter(u => !d.assignedUsers?.some((au: any) => au.id === u.id))
                                .map(u => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                  </option>
                                ))}
                            </select>
                          )}
                        </span>
                      ) : (d.assignedUsers && d.assignedUsers.length > 0) ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-txt-muted">👤 Restricted to:</span>
                          {d.assignedUsers.map(u => (
                            <span key={u.id} className="bg-teal-glow text-teal text-[10px] px-1.5 py-0.5 rounded font-medium border border-teal/15">
                              {u.name}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-txt-muted">👤 Accessible by all Org Users</span>
                      )}
  
                      {me?.role === 'SUPER_ADMIN' && orgs.length > 0 && (
                        <span className="flex items-center gap-1">
                          <span className="text-txt-muted">🏢 Org:</span>
                          <select
                            value={d.teamId || ''}
                            onChange={(e) => {
                              if (e.target.value && confirm(`Are you sure you want to move this screen to another organization? This will clear its playlists, schedules, and viewer restrictions.`)) {
                                moveDevice.mutate({ id: d.id, teamId: e.target.value })
                              }
                            }}
                            className="bg-card border border-border text-txt-secondary rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-teal transition-colors cursor-pointer"
                          >
                            {orgs.map((org: any) => (
                              <option key={org.id} value={org.id}>
                                {org.name}
                              </option>
                            ))}
                          </select>
                        </span>
                      )}

                      {(me?.role === 'TEAM_ADMIN' || me?.role === 'SUPER_ADMIN') && (
                        <span className="flex items-center gap-1">
                          <span className="text-txt-muted">🔄 Orientation:</span>
                          <select
                            value={d.orientation || 'LANDSCAPE'}
                            onChange={(e) => {
                              updateDevice.mutate({ id: d.id, orientation: e.target.value })
                            }}
                            className="bg-card border border-border text-txt-secondary rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-teal transition-colors cursor-pointer"
                          >
                            <option value="LANDSCAPE">Landscape (0°)</option>
                            <option value="PORTRAIT">Portrait (90° CW)</option>
                            <option value="LANDSCAPE_FLIPPED">Landscape Flipped (180°)</option>
                            <option value="PORTRAIT_FLIPPED">Portrait Flipped (270° CW)</option>
                          </select>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
  
                <div className="flex gap-1.5 flex-wrap sm:flex-shrink-0 sm:ml-auto">
                  {d.online ? <>
                    <ActionBtn
                      label="📷 Screenshot"
                      loading={requesting === d.id + 'cmd:screenshot'}
                      onClick={() => cmd(d, 'cmd:screenshot')} />
                    <ActionBtn
                      label="📋 Logs"
                      loading={requesting === d.id + 'cmd:get_logs'}
                      onClick={() => cmd(d, 'cmd:get_logs')} />
                    <ActionBtn
                      label="📟 Shell"
                      onClick={() => setTerminalDevice(d)} />
                    <ActionBtn label="Restart"  onClick={() => cmd(d, 'cmd:restart')} />
                    <ActionBtn label="Reboot"   onClick={() => cmd(d, 'cmd:reboot')} />
                    <ActionBtn label="Shutdown" danger onClick={() => cmd(d, 'cmd:shutdown')} />
                  </> : (
                    <span className="text-xs text-txt-muted italic">Offline</span>
                  )}
                  <ActionBtn
                    label="Remove" danger
                    onClick={() => { if (confirm('Remove device?')) del.mutate(d.id) }} />
                </div>
              </div>
  
              {/* Screenshot preview strip on the device row */}
              {d.screenshotUrl && (
                <div
                  className="mt-3 pt-3 border-t border-border flex items-center gap-3 cursor-pointer group"
                  onClick={() => setSsDevice(d)}>
                  <img
                    src={`${d.screenshotUrl}?t=${d.screenshotAt ? new Date(d.screenshotAt).getTime() : 0}`}
                    alt="Last screenshot"
                    className="w-24 h-14 object-cover rounded border border-border group-hover:border-teal/50 transition-colors flex-shrink-0"
                  />
                  <div className="text-xs text-txt-muted">
                    <p className="text-txt-secondary">Last screenshot</p>
                    {d.screenshotAt && (
                      <p>{formatDistanceToNow(new Date(d.screenshotAt), { addSuffix: true })}</p>
                    )}
                    <p className="text-teal mt-0.5 group-hover:underline">Click to enlarge</p>
                  </div>
                </div>
              )}
            </div>
          ))}
  
          {devices.length === 0 && (
            <div className="card py-12 text-center text-txt-secondary text-sm">
              No devices yet — click <span className="text-teal">+ Add device</span> to register your first Pi.
            </div>
          )}
        </div>
      )}

      {activeTab === 'groups' && (
        <div className="space-y-2">
          {groups.map(g => {
            const memberIds = g.members.map((m: any) => m.device.id)
            const playlistIdSet = new Set(g.members.map((m: any) => m.device.currentPlaylistId))
            const commonPlaylistId = playlistIdSet.size === 1 ? (Array.from(playlistIdSet)[0] as string || '') : ''

            return (
              <div key={g.id} className="card">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-txt-primary">{g.name}</span>
                      <span className="text-[10px] bg-border/40 border border-border text-txt-secondary px-1.5 py-0.5 rounded font-mono">
                        {g.members.length} screens
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {g.members.map((m: any) => {
                        const devOnline = devices.find((d: any) => d.id === m.device.id)?.online ?? false
                        return (
                          <span key={m.device.id} className={`inline-flex items-center gap-1 bg-surface border border-border/60 text-txt-secondary px-2 py-0.5 rounded-full ${devOnline ? 'border-teal/30 text-teal' : 'border-border/30 text-txt-muted'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${devOnline ? 'bg-teal animate-pulse-slow' : 'bg-coral'}`} />
                            {m.device.name}
                          </span>
                        )
                      })}
                      {g.members.length === 0 && (
                        <span className="text-txt-muted italic text-[11px]">No screens in this group</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 sm:flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-txt-secondary font-medium">Deploy Playlist:</span>
                      <select
                        value={commonPlaylistId || ''}
                        onChange={(e) => {
                          deployPlaylistToGroup.mutate({
                            id: g.id,
                            currentPlaylistId: e.target.value || null
                          })
                        }}
                        className="bg-card border border-border text-txt-secondary rounded px-2 py-1 text-xs focus:outline-none focus:border-teal cursor-pointer"
                      >
                        <option value="">No Playlist (Clear)</option>
                        {playlists.map((pl: any) => (
                          <option key={pl.id} value={pl.id}>
                            {pl.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-1">
                      <ActionBtn
                        label="Edit"
                        onClick={() => {
                          setEditGroup({
                            id: g.id,
                            name: g.name,
                            deviceIds: memberIds
                          })
                        }}
                      />
                      <ActionBtn
                        label="Remove"
                        danger
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this group? Displays in the group will not be affected.')) {
                            deleteGroup.mutate(g.id)
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {groups.length === 0 && (
            <div className="card py-12 text-center text-txt-secondary text-sm">
              No device groups yet — click <span className="text-teal">+ Add Group</span> to organize your screens.
            </div>
          )}
        </div>
      )}

      {showAddGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && setShowAddGroup(false)}>
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <h3 className="font-semibold text-sm">Create New Device Group</h3>
            
            <div className="space-y-3">
              <input
                className="input"
                placeholder="Group name (e.g. Lobby Screens)"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                autoFocus
              />

              <div className="space-y-1.5">
                <label className="text-[10px] text-txt-secondary font-semibold uppercase tracking-wider">Select Screens</label>
                <div className="border border-border rounded-lg p-2 max-h-48 overflow-y-auto bg-base/40 space-y-1">
                  {devices.map(d => (
                    <label key={d.id} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-border/20 rounded-md transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedDevices.includes(d.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDevices(prev => [...prev, d.id])
                          } else {
                            setSelectedDevices(prev => prev.filter(id => id !== d.id))
                          }
                        }}
                        className="rounded border-border bg-surface text-teal focus:ring-0 focus:ring-offset-0 h-4 w-4"
                      />
                      <span className="text-xs font-medium text-txt-primary flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${d.online ? 'bg-teal' : 'bg-coral'}`} />
                        {d.name}
                        {d.location && <span className="text-[10px] text-txt-muted">({d.location})</span>}
                      </span>
                    </label>
                  ))}
                  {devices.length === 0 && (
                    <p className="text-xs text-txt-muted italic p-2 text-center">No screens registered yet.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-border/40 justify-end">
              <button
                onClick={() => {
                  createGroup.mutate({
                    name: groupName,
                    deviceIds: selectedDevices
                  })
                }}
                disabled={!groupName.trim() || createGroup.isPending}
                className="btn-primary"
              >
                {createGroup.isPending ? 'Creating...' : 'Create Group'}
              </button>
              <button
                onClick={() => {
                  setShowAddGroup(false)
                  setGroupName('')
                  setSelectedDevices([])
                }}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && setEditGroup(null)}>
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <h3 className="font-semibold text-sm">Edit Device Group</h3>
            
            <div className="space-y-3">
              <input
                className="input"
                placeholder="Group name"
                value={editGroup.name}
                onChange={e => setEditGroup((prev: any) => ({ ...prev, name: e.target.value }))}
                autoFocus
              />

              <div className="space-y-1.5">
                <label className="text-[10px] text-txt-secondary font-semibold uppercase tracking-wider">Select Screens</label>
                <div className="border border-border rounded-lg p-2 max-h-48 overflow-y-auto bg-base/40 space-y-1">
                  {devices.map(d => (
                    <label key={d.id} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-border/20 rounded-md transition-colors">
                      <input
                        type="checkbox"
                        checked={editGroup.deviceIds.includes(d.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditGroup((prev: any) => ({
                              ...prev,
                              deviceIds: [...prev.deviceIds, d.id]
                            }))
                          } else {
                            setEditGroup((prev: any) => ({
                              ...prev,
                              deviceIds: prev.deviceIds.filter((id: string) => id !== d.id)
                            }))
                          }
                        }}
                        className="rounded border-border bg-surface text-teal focus:ring-0 focus:ring-offset-0 h-4 w-4"
                      />
                      <span className="text-xs font-medium text-txt-primary flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${d.online ? 'bg-teal' : 'bg-coral'}`} />
                        {d.name}
                        {d.location && <span className="text-[10px] text-txt-muted">({d.location})</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-border/40 justify-end">
              <button
                onClick={() => {
                  updateGroup.mutate({
                    id: editGroup.id,
                    name: editGroup.name,
                    deviceIds: editGroup.deviceIds
                  })
                }}
                disabled={!editGroup.name.trim() || updateGroup.isPending}
                className="btn-primary"
              >
                {updateGroup.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => setEditGroup(null)}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Log viewer drawer ── */}
      {logDevice && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-base/70 backdrop-blur-sm" onClick={() => setLogDevice(null)} />

          {/* Drawer */}
          <div className="w-full max-w-xl bg-surface border-l border-border flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
              <div>
                <p className="font-semibold">Logs — {logDevice.name}</p>
                <p className="text-xs text-txt-muted mt-0.5">Last 200 entries · newest first</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { refetchLogs(); toast.success('Refreshed') }}
                  className="btn-ghost text-xs">↻ Refresh</button>
                <button
                  onClick={() => cmd(logDevice, 'cmd:get_logs')}
                  className="btn-ghost text-xs">Request new</button>
                <button onClick={() => setLogDevice(null)} className="btn-ghost text-sm">✕</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
              {logsLoading ? (
                <p className="text-txt-muted">Loading…</p>
              ) : logs.length === 0 ? (
                <p className="text-txt-muted">No logs yet — click "Request new" to pull fresh logs from the device.</p>
              ) : (
                [...logs].sort((a, b) =>
                  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                ).map(log => (
                  <div key={log.id} className="flex gap-3 items-start hover:bg-border/30 rounded px-2 py-1 -mx-2">
                    <span className="text-txt-muted flex-shrink-0 tabular-nums">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </span>
                    <span className={`uppercase text-[10px] font-bold w-8 flex-shrink-0 mt-0.5 ${logLevelColor[log.level] ?? 'text-txt-secondary'}`}>
                      {log.level}
                    </span>
                    <span className="text-txt-secondary break-all">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Screenshot full-screen viewer ── */}
      {ssDevice && (
        <div
          className="fixed inset-0 z-50 bg-base/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSsDevice(null)}>
          <div className="max-w-5xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-semibold">{ssDevice.name}</p>
                {ssDevice.screenshotAt ? (
                  <p className="text-xs text-txt-muted">
                    Captured {formatDistanceToNow(new Date(ssDevice.screenshotAt), { addSuffix: true })}
                  </p>
                ) : (
                  <p className="text-xs text-txt-muted">Waiting for screenshot…</p>
                )}
              </div>
              <div className="flex gap-2">
                {ssDevice.screenshotUrl && (
                  <a
                    href={`${ssDevice.screenshotUrl}?t=${ssDevice.screenshotAt ? new Date(ssDevice.screenshotAt).getTime() : 0}`}
                    download={`${ssDevice.name}-screenshot.png`}
                    className="btn-ghost text-xs"
                    onClick={e => e.stopPropagation()}>
                    ↓ Download
                  </a>
                )}
                <button onClick={() => setSsDevice(null)} className="btn-ghost text-sm">✕ Close</button>
              </div>
            </div>

            {ssDevice.screenshotUrl ? (
              <img
                src={`${ssDevice.screenshotUrl}?t=${ssDevice.screenshotAt ? new Date(ssDevice.screenshotAt).getTime() : 0}`}
                alt="Screenshot"
                className="w-full rounded-xl border border-border"
              />
            ) : (
              <div className="w-full aspect-video rounded-xl border border-border bg-surface flex items-center justify-center">
                <p className="text-txt-muted text-sm">Screenshot requested — check back in a moment</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Terminal full-screen viewer ── */}
      {terminalDevice && (
        <TerminalModal device={terminalDevice} onClose={() => setTerminalDevice(null)} />
      )}
      
    </div>
  )
}

function ActionBtn({ label, onClick, danger, loading }: {
  label: string; onClick: () => void; danger?: boolean; loading?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`btn-ghost py-1 text-xs transition-colors ${danger ? 'text-txt-muted hover:text-coral' : ''} ${loading ? 'opacity-50' : ''}`}>
      {loading ? '…' : label}
    </button>
  )
}

function TerminalModal({ device, onClose }: { device: Device; onClose: () => void }) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<any>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!terminalRef.current) return

    const token = localStorage.getItem('access_token')

    const socket = io(window.location.origin, {
      auth: { token }
    })
    socketRef.current = socket

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#080B14',
        foreground: '#E8EAF0',
        cursor: '#26E4C8',
        selectionBackground: '#26E4C840',
        black: '#080B14',
        red: '#F25757',
        green: '#26E4C8',
        yellow: '#F5A623',
        blue: '#26E4C8',
        magenta: '#F25757',
        cyan: '#26E4C8',
        white: '#E8EAF0',
      },
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      rows: 24,
      cols: 80
    })
    termRef.current = term

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)

    term.open(terminalRef.current)
    fitAddon.fit()

    term.writeln('Connecting to device terminal...')

    socket.on('connect', () => {
      term.writeln('Connected to server, requesting terminal session...')
      socket.emit('terminal:start', { deviceId: device.id })
    })

    socket.on('terminal:output', ({ data }) => {
      term.write(data)
    })

    socket.on('terminal:error', (msg) => {
      term.writeln(`\r\n\x1b[31m[Error] ${msg}\x1b[0m`)
    })

    socket.on('disconnect', () => {
      term.writeln('\r\n\x1b[31mDisconnected from server.\x1b[0m')
    })

    term.onData((data) => {
      socket.emit('terminal:input', { data })
    })

    const handleResize = () => {
      try {
        fitAddon.fit()
        socket.emit('terminal:resize', {
          cols: term.cols,
          rows: term.rows
        })
      } catch (err) {}
    }

    window.addEventListener('resize', handleResize)
    const resizeTimeout = setTimeout(handleResize, 500)

    return () => {
      clearTimeout(resizeTimeout)
      window.removeEventListener('resize', handleResize)
      socket.emit('terminal:stop')
      socket.disconnect()
      term.dispose()
    }
  }, [device.id])

  return (
    <div className="fixed inset-0 z-50 bg-base/95 backdrop-blur-sm flex flex-col p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-md font-semibold text-txt-primary">Remote Shell — {device.name}</h2>
          <p className="text-xs text-txt-secondary mt-0.5">Secure WebSocket terminal session</p>
        </div>
        <button onClick={onClose} className="btn-ghost text-sm">✕ Close Shell</button>
      </div>
      <div className="flex-1 bg-[#080B14] border border-border rounded-xl p-4 overflow-hidden relative">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  )
}


