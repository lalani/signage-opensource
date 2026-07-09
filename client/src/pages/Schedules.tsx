import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Schedule {
  id: string
  deviceId?: string
  device?: { id: string; name: string; location?: string }
  groupId?: string
  group?: { id: string; name: string }
  playlistId: string
  playlist: { id: string; name: string }
  startTime: string   // "HH:MM"
  endTime: string     // "HH:MM"
  daysOfWeek: number[]
  priority: number
  isActive: boolean
}
interface Device   { id: string; name: string; location?: string; online: boolean }
interface Playlist { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Deterministic palette — assigned per playlist so colours are stable
const PALETTE = [
  { bar: 'bg-teal/25 border-teal/50',   text: 'text-teal',         dot: 'bg-teal'         },
  { bar: 'bg-amber/25 border-amber/50', text: 'text-amber',        dot: 'bg-amber'        },
  { bar: 'bg-coral/25 border-coral/50', text: 'text-coral',        dot: 'bg-coral'        },
  { bar: 'bg-purple-400/25 border-purple-400/50', text: 'text-purple-400', dot: 'bg-purple-400' },
  { bar: 'bg-blue-400/25 border-blue-400/50',     text: 'text-blue-400',   dot: 'bg-blue-400'   },
  { bar: 'bg-green-400/25 border-green-400/50',   text: 'text-green-400',  dot: 'bg-green-400'  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const toMins  = (t: string) => { const [h,m] = t.split(':').map(Number); return h*60+m }
const toPct   = (mins: number) => (mins / 1440) * 100
const durMins = (s: string, e: string) => {
  const sm = toMins(s), em = toMins(e)
  return em > sm ? em - sm : 1440 - sm + em   // handles midnight-spanning windows
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Schedules() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]     = useState<Schedule | null>(null)
  const [initialDefaults, setInitialDefaults] = useState<{ deviceId?: string; daysOfWeek?: number[] } | null>(null)

  const { data: schedules = [] } = useQuery<Schedule[]>({
    queryKey: ['schedules'],
    queryFn: () => api.get('/schedules').then(r => r.data),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/schedules/${id}`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      toast.success('Schedule status updated')
    },
    onError: () => {
      toast.error('Failed to update schedule')
    }
  })
  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then(r => r.data),
  })
  const { data: groups = [] } = useQuery<any[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then(r => r.data),
  })
  const { data: playlists = [] } = useQuery<Playlist[]>({
    queryKey: ['playlists'],
    queryFn: () => api.get('/playlists').then(r => r.data),
  })

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/schedules/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schedules'] }); toast.success('Removed') },
  })

  // Stable colour map: playlistId → palette index
  const colourOf = useMemo(() => {
    const m = new Map<string, number>()
    playlists.forEach((pl, i) => m.set(pl.id, i % PALETTE.length))
    return (id: string) => PALETTE[m.get(id) ?? 0]
  }, [playlists])

  // Group schedules by deviceId (directly or via group membership) for fast timeline lookup
  const schedulesByDevice = useMemo(() => {
    const m = new Map<string, Schedule[]>()
    for (const d of devices) {
      m.set(d.id, [])
    }
    for (const s of schedules) {
      if (s.deviceId) {
        if (!m.has(s.deviceId)) m.set(s.deviceId, [])
        m.get(s.deviceId)!.push(s)
      } else if (s.groupId) {
        const grp = groups.find(g => g.id === s.groupId)
        if (grp && grp.members) {
          for (const member of grp.members) {
            const devId = member.device.id
            if (!m.has(devId)) m.set(devId, [])
            m.get(devId)!.push(s)
          }
        }
      }
    }
    return m
  }, [schedules, devices, groups])

  function openEdit(s: Schedule) { setEditing(s); setInitialDefaults(null); setShowModal(true) }
  function openNew()             { setEditing(null); setInitialDefaults(null); setShowModal(true) }
  function openNewWithDefaults(deviceId: string, dayIdx: number) {
    setEditing(null)
    setInitialDefaults({ deviceId, daysOfWeek: [dayIdx] })
    setShowModal(true)
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Schedules</h1>
          <p className="text-txt-secondary text-sm mt-0.5">
            Automatic playlist switching by time and day
          </p>
        </div>
        <button onClick={openNew} className="btn-primary">+ New schedule</button>
      </div>

      {/* ── Playlist colour legend ── */}
      {playlists.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {playlists.map(pl => {
            const c = colourOf(pl.id)
            return (
              <span key={pl.id}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${c.bar} ${c.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                {pl.name}
              </span>
            )
          })}
        </div>
      )}

      {/* ── Week timeline grid ── */}
      {devices.length === 0 ? (
        <div className="card py-12 text-center text-txt-secondary text-sm">
          No devices yet — add devices before creating schedules.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
        <div className="min-w-[640px]">

          {/* Column headers */}
          <div className="grid border-b border-border bg-surface"
            style={{ gridTemplateColumns: '140px repeat(7, 1fr)' }}>
            <div className="sticky left-0 z-10 py-2.5 px-4 text-xs text-txt-muted border-r border-border bg-surface">
              Device
            </div>
            {DAYS.map(d => (
              <div key={d} className="py-2.5 text-center text-xs text-txt-secondary border-r border-border last:border-r-0">
                {d}
              </div>
            ))}
          </div>

          {/* Time-axis tick labels row */}
          <div className="grid border-b border-border/50 bg-surface/60"
            style={{ gridTemplateColumns: '140px repeat(7, 1fr)' }}>
            <div className="sticky left-0 z-10 border-r border-border bg-surface/60" />
            {DAYS.map((_, di) => (
              <div key={di} className="relative h-5 border-r border-border last:border-r-0">
                {['6', '12', '18'].map((lbl, li) => (
                  <span key={lbl}
                    style={{ left: `${(li + 1) * 25}%` }}
                    className="absolute top-1 -translate-x-1/2 text-[9px] text-txt-muted font-mono select-none">
                    {lbl}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {/* One row per device */}
          {devices.map((device, di) => {
            const devSchedules = schedulesByDevice.get(device.id) ?? []
            const rowBg = di % 2 !== 0 ? 'bg-surface/30' : 'bg-surface'
            return (
              <div key={device.id}
                className={`grid border-b border-border last:border-b-0 ${di % 2 !== 0 ? 'bg-surface/30' : ''}`}
                style={{ gridTemplateColumns: '140px repeat(7, 1fr)' }}>

                {/* Device name */}
                <div className={`sticky left-0 z-10 flex items-center gap-2.5 px-4 py-2 border-r border-border min-w-0 ${rowBg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${device.online ? 'bg-teal' : 'bg-coral/50'}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{device.name}</p>
                    {device.location && (
                      <p className="text-[10px] text-txt-muted truncate">{device.location}</p>
                    )}
                  </div>
                </div>

                {/* Day cells */}
                {DAYS.map((_, dayIdx) => {
                  const daySlots = devSchedules.filter(
                    s => s.isActive && s.daysOfWeek.includes(dayIdx)
                  )
                  return (
                    <div key={dayIdx}
                      onClick={() => openNewWithDefaults(device.id, dayIdx)}
                      className="relative h-12 border-r border-border last:border-r-0 overflow-hidden hover:bg-border/10 cursor-pointer transition-colors">

                      {/* 6h tick marks */}
                      {[25, 50, 75].map(pct => (
                        <div key={pct}
                          style={{ left: `${pct}%` }}
                          className="absolute inset-y-0 w-px bg-border/40" />
                      ))}

                      {/* Schedule blocks */}
                      {daySlots.map(s => {
                        const left  = toPct(toMins(s.startTime))
                        const width = toPct(durMins(s.startTime, s.endTime))
                        const c     = colourOf(s.playlistId)
                        return (
                          <div key={s.id}
                            style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                            className={`absolute top-1.5 bottom-1.5 rounded border cursor-pointer group transition-opacity hover:opacity-90 ${c.bar}`}
                            title={`${s.playlist.name}\n${s.startTime}–${s.endTime}`}
                            onClick={() => openEdit(s)}
                          >
                            {/* Label only if block is wide enough */}
                            {width > 12 && (
                              <span className={`absolute inset-0 flex items-center px-1 text-[9px] font-medium truncate ${c.text}`}>
                                {s.playlist.name}
                              </span>
                            )}
                            {/* ✕ delete on hover */}
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                if (confirm('Delete this schedule?')) del.mutate(s.id)
                              }}
                              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-coral text-base flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-100 transition-opacity z-10">
                              ✕
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
        </div>
      )}

      {/* ── Schedule list ── */}
      {schedules.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-txt-secondary mb-3">All schedules</h2>
          <div className="space-y-1.5">
            {schedules.map(s => {
              const c      = colourOf(s.playlistId)
              const dayStr = [...s.daysOfWeek].sort().map(d => DAYS[d]).join(' · ')
              return (
                <div key={s.id} className="card flex items-center gap-4">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot} ${!s.isActive ? 'opacity-30' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium flex items-center gap-1.5">
                        {s.deviceId ? (
                          <span>🖥️ {s.device?.name || '—'}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-teal-glow text-teal border border-teal/15 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase">
                            👥 {s.group?.name || 'Group'}
                          </span>
                        )}
                      </span>
                      <span className="text-txt-muted text-xs">→</span>
                      <span className={`text-sm font-medium ${c.text}`}>{s.playlist.name}</span>
                      {!s.isActive && (
                        <span className="text-[10px] border border-border text-txt-muted px-1.5 py-0.5 rounded-full">inactive</span>
                      )}
                    </div>
                    <p className="text-xs text-txt-muted font-mono mt-0.5">
                      {s.startTime} – {s.endTime}
                      {'  ·  '}
                      {dayStr}
                      {s.priority > 0 ? `  ·  priority ${s.priority}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Quick active toggle */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleActive.mutate({ id: s.id, isActive: !s.isActive })
                      }}
                      disabled={toggleActive.isPending}
                      className="flex items-center gap-1.5 cursor-pointer"
                      title={s.isActive ? "Pause schedule" : "Activate schedule"}
                    >
                      <div className={`w-7 h-4 rounded-full relative transition-colors ${s.isActive ? 'bg-teal' : 'bg-border'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${s.isActive ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                      </div>
                    </button>
                    <button onClick={() => openEdit(s)} className="btn-ghost text-xs">Edit</button>
                    <button
                      onClick={() => { if (confirm('Delete this schedule?')) del.mutate(s.id) }}
                      className="btn-ghost text-xs text-txt-muted hover:text-coral">
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {schedules.length === 0 && devices.length > 0 && (
        <div className="card py-12 text-center text-txt-secondary text-sm">
          No schedules yet — click <span className="text-teal">+ New schedule</span> to add one.
        </div>
      )}

      {/* ── Modal ── */}
      {showModal && (
        <ScheduleModal
          schedule={editing}
          initialDefaults={initialDefaults}
          devices={devices}
          groups={groups}
          playlists={playlists}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['schedules'] })
            setShowModal(false)
            toast.success(editing ? 'Schedule updated' : 'Schedule created')
          }}
        />
      )}
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function ScheduleModal({ schedule, initialDefaults, devices, groups, playlists, onClose, onSaved }: {
  schedule: Schedule | null
  initialDefaults: { deviceId?: string; daysOfWeek?: number[] } | null
  devices: Device[]
  groups: any[]
  playlists: Playlist[]
  onClose: () => void
  onSaved: () => void
}) {
  const [targetType, setTargetType] = useState<'device' | 'group'>(schedule?.groupId ? 'group' : 'device')
  const [deviceId,   setDeviceId]   = useState(schedule?.deviceId   ?? initialDefaults?.deviceId ?? devices[0]?.id   ?? '')
  const [groupId,    setGroupId]    = useState(schedule?.groupId    ?? groups[0]?.id    ?? '')
  const [playlistId, setPlaylistId] = useState(schedule?.playlistId ?? playlists[0]?.id ?? '')
  const [startTime,  setStartTime]  = useState(schedule?.startTime  ?? '08:00')
  const [endTime,    setEndTime]    = useState(schedule?.endTime    ?? '18:00')
  const [days,       setDays]       = useState<number[]>(schedule?.daysOfWeek ?? initialDefaults?.daysOfWeek ?? [1,2,3,4,5])
  const [priority,   setPriority]   = useState(schedule?.priority   ?? 0)
  const [isActive,   setIsActive]   = useState(schedule?.isActive   ?? true)
  const [saving,     setSaving]     = useState(false)

  useEffect(() => {
    if (!deviceId && devices.length > 0) {
      setDeviceId(devices[0].id)
    }
  }, [devices, deviceId])

  useEffect(() => {
    if (!groupId && groups.length > 0) {
      setGroupId(groups[0].id)
    }
  }, [groups, groupId])

  useEffect(() => {
    if (!playlistId && playlists.length > 0) {
      setPlaylistId(playlists[0].id)
    }
  }, [playlists, playlistId])

  const toggleDay = (d: number) =>
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())

  const setPreset = (preset: number[]) => setDays(preset)

  async function save() {
    const isDevice = targetType === 'device'
    if (isDevice && !deviceId) return
    if (!isDevice && !groupId) return
    if (!playlistId || days.length === 0) return
    setSaving(true)
    try {
      const payload = {
        deviceId: isDevice ? deviceId : null,
        groupId: !isDevice ? groupId : null,
        playlistId,
        startTime,
        endTime,
        daysOfWeek: days,
        priority,
        isActive
      }
      if (schedule) await api.patch(`/schedules/${schedule.id}`, payload)
      else          await api.post('/schedules', payload)
      onSaved()
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Preview duration
  const dur = durMins(startTime, endTime)
  const durLabel = dur >= 60
    ? `${Math.floor(dur / 60)}h ${dur % 60 > 0 ? `${dur % 60}m` : ''}`.trim()
    : `${dur}m`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">{schedule ? 'Edit schedule' : 'New schedule'}</h2>
          <button onClick={onClose} className="text-txt-muted hover:text-txt-primary transition-colors text-lg leading-none">×</button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">

          {/* Target Type Selector */}
          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Schedule Target</label>
            <div className="flex bg-base p-1 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setTargetType('device')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  targetType === 'device'
                    ? 'bg-surface text-teal shadow border border-border/80'
                    : 'text-txt-secondary hover:text-txt-primary'
                }`}
              >
                🖥️ Screen
              </button>
              <button
                type="button"
                onClick={() => setTargetType('group')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  targetType === 'group'
                    ? 'bg-surface text-teal shadow border border-border/80'
                    : 'text-txt-secondary hover:text-txt-primary'
                }`}
              >
                👥 Screen Group
              </button>
            </div>
          </div>

          {/* Target Dropdown */}
          {targetType === 'device' ? (
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">Select Screen</label>
              <select className="input" value={deviceId} onChange={e => setDeviceId(e.target.value)}>
                <option value="">Select a screen...</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.location ? ` — ${d.location}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">Select Screen Group</label>
              <select className="input" value={groupId} onChange={e => setGroupId(e.target.value)}>
                <option value="">Select a group...</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.members.length} screens)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Playlist */}
          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Playlist</label>
            <select className="input" value={playlistId} onChange={e => setPlaylistId(e.target.value)}>
              {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
          </div>

          {/* Time window */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-txt-secondary">Time window</label>
              <span className="text-xs font-mono text-txt-muted">{durLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="input font-mono flex-1" />
              <span className="text-txt-muted text-sm flex-shrink-0">→</span>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="input font-mono flex-1" />
            </div>
            <p className="text-[10px] text-txt-muted mt-1">
              Times spanning midnight (e.g. 22:00 → 06:00) are supported.
            </p>
            {/* Time Presets */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { label: '🌅 Morning', start: '08:00', end: '12:00' },
                { label: '☀️ Afternoon', start: '12:00', end: '17:00' },
                { label: '🌆 Evening', start: '17:00', end: '22:00' },
                { label: '⏰ Business', start: '09:00', end: '17:00' },
                { label: '🌃 Night', start: '22:00', end: '06:00' },
              ].map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setStartTime(p.start)
                    setEndTime(p.end)
                  }}
                  className="px-2 py-0.5 rounded bg-border/40 hover:bg-border text-[10px] text-txt-secondary transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Days of week */}
          <div>
            <label className="block text-xs text-txt-secondary mb-2">Days</label>
            <div className="flex gap-1.5 mb-2">
              {DAYS.map((d, i) => (
                <button key={i} onClick={() => toggleDay(i)}
                  className={`w-9 h-9 rounded-lg text-xs font-semibold transition-all ${
                    days.includes(i)
                      ? 'bg-teal text-base shadow-sm shadow-teal/30'
                      : 'bg-border text-txt-secondary hover:bg-border/70'
                  }`}>
                  {d[0]}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              {[
                { label: 'Weekdays', preset: [1,2,3,4,5] },
                { label: 'Weekends', preset: [0,6] },
                { label: 'Every day', preset: [0,1,2,3,4,5,6] },
              ].map(({ label, preset }) => (
                <button key={label} onClick={() => setPreset(preset)}
                  className="text-xs text-txt-muted hover:text-teal transition-colors">
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority + Active */}
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">
                Priority <span className="text-txt-muted">(higher wins)</span>
              </label>
              <input type="number" min={0} max={100} value={priority}
                onChange={e => setPriority(Number(e.target.value))}
                className="input w-20 font-mono" />
            </div>
            <div className="mt-4">
              <button onClick={() => setIsActive(!isActive)}
                className="flex items-center gap-2.5 cursor-pointer">
                <div className={`w-9 h-5 rounded-full relative transition-colors ${isActive ? 'bg-teal' : 'bg-border'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-sm text-txt-secondary">{isActive ? 'Active' : 'Paused'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between">
          <p className="text-xs text-txt-muted">
            {days.length} day{days.length !== 1 ? 's' : ''} selected
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save}
              disabled={saving || (targetType === 'device' ? !deviceId : !groupId) || !playlistId || days.length === 0}
              className="btn-primary">
              {saving ? 'Saving…' : schedule ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
