import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuth } from '../lib/store'

interface Widget {
  id: string
  name: string
  type: 'CLOCK' | 'WEATHER' | 'TICKER'
  position: string
  settings: string
  devices: { id: string; name: string }[]
  createdAt: string
}

const POSITIONS = [
  { value: 'TOP_LEFT', label: 'Top Left' },
  { value: 'TOP_RIGHT', label: 'Top Right' },
  { value: 'BOTTOM_LEFT', label: 'Bottom Left' },
  { value: 'BOTTOM_RIGHT', label: 'Bottom Right' },
  { value: 'TOP_CENTER', label: 'Top Center' },
  { value: 'BOTTOM_CENTER', label: 'Bottom Center' },
  { value: 'CENTER', label: 'Center' },
  { value: 'TOP_BAR', label: 'Top Bar (Full Width)' },
  { value: 'BOTTOM_BAR', label: 'Bottom Bar (Full Width)' },
  { value: 'LEFT_BAR', label: 'Left Bar (Full Height)' },
  { value: 'RIGHT_BAR', label: 'Right Bar (Full Height)' },
  { value: 'CUSTOM', label: 'Custom (Drag-and-Drop)' }
]

export default function Widgets() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const [showModal, setShowModal] = useState(false)
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null)

  // Form states
  const [name, setName] = useState('')
  const [type, setType] = useState<'CLOCK' | 'WEATHER' | 'TICKER'>('CLOCK')
  const [position, setPosition] = useState('TOP_RIGHT')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])
  const [customTop, setCustomTop] = useState(10)
  const [customLeft, setCustomLeft] = useState(10)

  // Widget-specific settings
  const [timezone, setTimezone] = useState('America/New_York')
  const [format, setFormat] = useState('12h')
  const [city, setCity] = useState('Atlanta')
  const [unit, setUnit] = useState('F')
  const [tickerText, setTickerText] = useState('Welcome to Open Source Signage!')
  const [tickerSpeed, setTickerSpeed] = useState(15)
  const [fontSizeRem, setFontSizeRem] = useState(1.5)
  const [color, setColor] = useState('#ffffff')
  const [bg, setBg] = useState('rgba(0,0,0,0.55)')

  // Fetch widgets
  const { data: widgets = [], isLoading: widgetsLoading } = useQuery<Widget[]>({
    queryKey: ['widgets'],
    queryFn: () => api.get('/widgets').then(r => r.data)
  })

  // Fetch devices (for assignment)
  const { data: devices = [] } = useQuery<any[]>({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then(r => r.data)
  })

  const createWidget = useMutation({
    mutationFn: (data: any) => api.post('/widgets', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['widgets'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Widget created successfully')
      closeForm()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to create widget')
    }
  })

  const updateWidget = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.patch(`/widgets/${id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['widgets'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Widget updated successfully')
      closeForm()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to update widget')
    }
  })

  const deleteWidget = useMutation({
    mutationFn: (id: string) => api.delete(`/widgets/${id}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['widgets'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Widget deleted')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to delete widget')
    }
  })

  const openCreate = () => {
    setEditingWidget(null)
    setName('')
    setType('CLOCK')
    setPosition('TOP_RIGHT')
    setSelectedDeviceIds([])
    setTimezone('America/New_York')
    setFormat('12h')
    setCity('Atlanta')
    setUnit('F')
    setTickerText('Welcome to Open Source Signage!')
    setTickerSpeed(15)
    setFontSizeRem(1.5)
    setColor('#ffffff')
    setBg('rgba(0,0,0,0.55)')
    setCustomTop(10)
    setCustomLeft(10)
    setShowModal(true)
  }

  const openEdit = (w: Widget) => {
    setEditingWidget(w)
    setName(w.name)
    setType(w.type)
    setPosition(w.position)
    setSelectedDeviceIds(w.devices.map(d => d.id))
    
    let parsed: any = {}
    try {
      parsed = JSON.parse(w.settings)
    } catch (e) {}

    const rawFontSize = parsed.fontSize || '1.5rem'
    const num = parseFloat(rawFontSize) || 1.5
    setFontSizeRem(num)
    setColor(parsed.color || '#ffffff')
    setCustomTop(parsed.customTop !== undefined ? parsed.customTop : 10)
    setCustomLeft(parsed.customLeft !== undefined ? parsed.customLeft : 10)
    
    if (w.type === 'CLOCK') {
      setTimezone(parsed.timezone || 'America/New_York')
      setFormat(parsed.format || '12h')
    } else if (w.type === 'WEATHER') {
      setCity(parsed.city || 'Atlanta')
      setUnit(parsed.unit || 'F')
    } else if (w.type === 'TICKER') {
      setTickerText(parsed.text || '')
      setTickerSpeed(parsed.speed || 15)
      setBg(parsed.bg || 'rgba(0,0,0,0.55)')
    }

    setShowModal(true)
  }

  const closeForm = () => {
    setShowModal(false)
    setEditingWidget(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    let settingsObj: any = { fontSize: `${fontSizeRem}rem`, color }
    if (position === 'CUSTOM') {
      settingsObj.customTop = customTop
      settingsObj.customLeft = customLeft
    }
    if (type === 'CLOCK') {
      settingsObj.timezone = timezone
      settingsObj.format = format
    } else if (type === 'WEATHER') {
      settingsObj.city = city
      settingsObj.unit = unit
    } else if (type === 'TICKER') {
      settingsObj.text = tickerText
      settingsObj.speed = Number(tickerSpeed)
      settingsObj.bg = bg
    }

    const payload = {
      name: name.trim() || `${type} Widget`,
      type,
      position,
      settings: JSON.stringify(settingsObj),
      deviceIds: selectedDeviceIds
    }

    if (editingWidget) {
      updateWidget.mutate({ id: editingWidget.id, data: payload })
    } else {
      createWidget.mutate(payload)
    }
  }

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes widget-marquee {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-100%, 0, 0); }
        }
        .animate-widget-marquee {
          animation: widget-marquee linear infinite;
        }
      `}</style>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-txt-primary">Overlay Widgets</h1>
          <p className="text-sm text-txt-secondary">Manage and display clocks, weather, and scrolling tickers on your screens</p>
        </div>
        {(me?.role === 'SUPER_ADMIN' || me?.role === 'TEAM_ADMIN' || me?.role === 'CONTENT_CREATOR') && (
          <button onClick={openCreate} className="btn-primary flex items-center gap-1.5">
            <span>+ Create Widget</span>
          </button>
        )}
      </div>

      {widgetsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(n => (
            <div key={n} className="card h-40 animate-pulse bg-surface/40" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {widgets.map(w => (
            <div key={w.id} className="card flex flex-col justify-between h-full space-y-4">
              {/* Bounding Screen Preview Box */}
              <div className="w-full h-32 bg-neutral-950 border border-border/40 rounded-xl relative overflow-hidden flex items-center justify-center shadow-inner select-none">
                <div className="absolute inset-1.5 border border-dashed border-white/5 pointer-events-none rounded flex items-center justify-center">
                  <span className="text-[7px] text-white/5 uppercase tracking-widest font-mono">Screen Preview</span>
                </div>

                {(() => {
                  let parsed = {}
                  try {
                    parsed = JSON.parse(w.settings)
                  } catch (e) {}
                  const style = getWidgetPreviewStyle(w.position, parsed)
                  return (
                    <div style={style}>
                      {w.type === 'CLOCK' && <ClockWidgetPreview settings={parsed} scale={0.75} />}
                      {w.type === 'WEATHER' && <WeatherWidgetPreview settings={parsed} scale={0.75} />}
                      {w.type === 'TICKER' && <TickerWidgetPreview settings={parsed} scale={0.75} />}
                    </div>
                  )
                })()}
              </div>

              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm text-txt-primary truncate">{w.name}</h3>
                    <span className="text-[10px] bg-teal-glow border border-teal/15 text-teal px-1.5 py-0.5 rounded font-mono uppercase mt-1 inline-block">
                      {w.type}
                    </span>
                  </div>
                  <span className="text-[10px] bg-border/40 border border-border text-txt-secondary px-2 py-0.5 rounded font-mono">
                    {POSITIONS.find(p => p.value === w.position)?.label || w.position}
                  </span>
                </div>

                <div className="text-xs text-txt-secondary space-y-1 pt-1">
                  {w.type === 'CLOCK' && (
                    <p className="font-mono">Timezone: {JSON.parse(w.settings).timezone} ({JSON.parse(w.settings).format})</p>
                  )}
                  {w.type === 'WEATHER' && (
                    <p className="font-mono">City: {JSON.parse(w.settings).city} ({JSON.parse(w.settings).unit})</p>
                  )}
                  {w.type === 'TICKER' && (
                    <p className="truncate max-w-[250px]">Text: "{JSON.parse(w.settings).text}"</p>
                  )}
                </div>
              </div>

              <div className="border-t border-border/40 pt-3 flex flex-col space-y-3">
                <div>
                  <h4 className="text-[10px] text-txt-muted uppercase font-semibold tracking-wider mb-1.5">Assigned Screens ({w.devices.length})</h4>
                  <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                    {w.devices.map(d => (
                      <span key={d.id} className="bg-border/30 border border-border/60 text-txt-secondary text-[10px] px-2 py-0.5 rounded-md font-medium">
                        🖥️ {d.name}
                      </span>
                    ))}
                    {w.devices.length === 0 && (
                      <span className="text-[10px] text-txt-muted italic">Not assigned to any screens</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1.5">
                  <button onClick={() => openEdit(w)} className="text-xs text-teal hover:underline font-semibold px-2 py-1">
                    Edit Settings
                  </button>
                  <button
                    onClick={() => { if (confirm('Delete this widget?')) deleteWidget.mutate(w.id) }}
                    className="text-xs text-coral hover:underline font-semibold px-2 py-1"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}

          {widgets.length === 0 && (
            <div className="col-span-full card py-12 text-center text-txt-secondary text-sm border border-dashed border-border">
              No widgets configured yet. Click <span className="text-teal font-semibold">+ Create Widget</span> to add your first clock, weather feed, or ticker.
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4" onClick={closeForm}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col space-y-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/40 pb-4">
              <div>
                <h2 className="text-lg font-bold text-txt-primary">{editingWidget ? 'Edit Widget' : 'Create Widget'}</h2>
                <p className="text-txt-secondary text-xs mt-0.5">Configure overlay options and select target screens</p>
              </div>
              <button onClick={closeForm} className="text-txt-muted hover:text-txt-primary transition-colors text-xl font-bold">×</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-txt-secondary mb-1.5">Widget Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Lobby Clock"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="input text-xs"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-txt-secondary mb-1.5">Widget Type</label>
                      <select
                        value={type}
                        onChange={e => {
                          const newType = e.target.value as any
                          setType(newType)
                          if (newType === 'TICKER') {
                            setPosition('BOTTOM_BAR')
                          } else {
                            setPosition('TOP_RIGHT')
                          }
                        }}
                        className="input text-xs"
                        disabled={!!editingWidget}
                      >
                        <option value="CLOCK">🕒 Digital Clock</option>
                        <option value="WEATHER">🌤️ Weather</option>
                        <option value="TICKER">📢 Text Ticker</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-txt-secondary mb-1.5">Screen Position</label>
                      <select
                        value={position}
                        onChange={e => setPosition(e.target.value)}
                        className="input text-xs"
                      >
                        {POSITIONS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 mt-2">
                    <label className="block text-xs text-txt-secondary font-medium">Screen Position Preview (Widget Mock)</label>
                    <div
                      className="w-full aspect-video bg-neutral-950 border border-border rounded-xl relative overflow-hidden flex items-center justify-center shadow-inner"
                      style={{ cursor: position === 'CUSTOM' ? 'crosshair' : 'default' }}
                      onClick={(e) => {
                        if (position !== 'CUSTOM' || e.target !== e.currentTarget) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const x = e.clientX - rect.left
                        const y = e.clientY - rect.top
                        setCustomLeft(Math.min(100, Math.max(0, Math.round((x / rect.width) * 100))))
                        setCustomTop(Math.min(100, Math.max(0, Math.round((y / rect.height) * 100))))
                      }}
                    >
                      {/* Simulated screen border guidelines */}
                      <div className="absolute inset-4 border border-dashed border-white/5 pointer-events-none rounded-lg flex items-center justify-center">
                        <span className="text-[9px] text-white/10 uppercase tracking-widest font-mono">Simulated Screen Bounds</span>
                      </div>

                      {/* Positioned Live Widget Preview Box */}
                      {(() => {
                        const settingsObj = {
                          fontSize: `${fontSizeRem}rem`,
                          color,
                          timezone,
                          format,
                          city,
                          unit,
                          text: tickerText,
                          speed: Number(tickerSpeed),
                          bg,
                          customTop,
                          customLeft
                        }
                        const style = getWidgetPreviewStyle(position, settingsObj)

                        if (position === 'CUSTOM') {
                          return (
                            <div
                              className="absolute z-10 cursor-move select-none origin-center hover:scale-105 active:scale-95 transition-transform"
                              style={style}
                              onMouseDown={(e) => {
                                e.preventDefault()
                                const rect = e.currentTarget.parentElement?.getBoundingClientRect()
                                if (!rect) return

                                const handleMouseMove = (moveEvent: MouseEvent) => {
                                  const x = moveEvent.clientX - rect.left
                                  const y = moveEvent.clientY - rect.top
                                  const leftPct = Math.min(100, Math.max(0, Math.round((x / rect.width) * 100)))
                                  const topPct = Math.min(100, Math.max(0, Math.round((y / rect.height) * 100)))
                                  setCustomLeft(leftPct)
                                  setCustomTop(topPct)
                                }

                                const handleMouseUp = () => {
                                  window.removeEventListener('mousemove', handleMouseMove)
                                  window.removeEventListener('mouseup', handleMouseUp)
                                }

                                window.addEventListener('mousemove', handleMouseMove)
                                window.addEventListener('mouseup', handleMouseUp)
                              }}
                            >
                              {type === 'CLOCK' && <ClockWidgetPreview settings={settingsObj} scale={0.9} />}
                              {type === 'WEATHER' && <WeatherWidgetPreview settings={settingsObj} scale={0.9} />}
                              {type === 'TICKER' && <TickerWidgetPreview settings={settingsObj} scale={0.9} />}
                            </div>
                          )
                        }

                        // For standard preset positions, render static in position
                        return (
                          <div style={style} className="transition-all duration-300">
                            {type === 'CLOCK' && <ClockWidgetPreview settings={settingsObj} scale={0.9} />}
                            {type === 'WEATHER' && <WeatherWidgetPreview settings={settingsObj} scale={0.9} />}
                            {type === 'TICKER' && <TickerWidgetPreview settings={settingsObj} scale={0.9} />}
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Settings Panel */}
                  <div className="bg-surface/50 border border-border/40 rounded-xl p-3.5 space-y-3.5">
                    <h4 className="text-[10px] font-bold text-txt-primary uppercase tracking-wider">Widget Customization</h4>

                    {type === 'CLOCK' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-txt-secondary mb-1">Timezone</label>
                          <input
                            type="text"
                            value={timezone}
                            onChange={e => setTimezone(e.target.value)}
                            className="input text-xs py-1 px-2"
                            placeholder="America/New_York"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-txt-secondary mb-1">Format</label>
                          <select
                            value={format}
                            onChange={e => setFormat(e.target.value)}
                            className="input text-xs py-1 px-2"
                          >
                            <option value="12h">12-Hour (AM/PM)</option>
                            <option value="24h">24-Hour</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {type === 'WEATHER' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-txt-secondary mb-1">City Name</label>
                          <input
                            type="text"
                            value={city}
                            onChange={e => setCity(e.target.value)}
                            className="input text-xs py-1 px-2"
                            placeholder="e.g. Atlanta"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-txt-secondary mb-1">Temperature Unit</label>
                          <select
                            value={unit}
                            onChange={e => setUnit(e.target.value)}
                            className="input text-xs py-1 px-2"
                          >
                            <option value="F">Fahrenheit (°F)</option>
                            <option value="C">Celsius (°C)</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {type === 'TICKER' && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] text-txt-secondary mb-1">Scrolling Message</label>
                          <textarea
                            value={tickerText}
                            onChange={e => setTickerText(e.target.value)}
                            className="input text-xs py-1 px-2 h-16 resize-none"
                            placeholder="Enter marquee message..."
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] text-txt-secondary mb-1">Scroll Speed (sec)</label>
                            <input
                              type="number"
                              min="5"
                              max="60"
                              value={tickerSpeed}
                              onChange={e => setTickerSpeed(Number(e.target.value))}
                              className="input text-xs py-1 px-2"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-txt-secondary mb-1">Background Color</label>
                            <input
                              type="text"
                              value={bg}
                              onChange={e => setBg(e.target.value)}
                              className="input text-xs py-1 px-2 font-mono"
                              placeholder="rgba(0,0,0,0.55)"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Shared Styling */}
                    <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-border/30">
                      <div>
                        <div className="flex justify-between items-baseline mb-1">
                          <label className="block text-[10px] text-txt-secondary font-semibold">Font Size</label>
                          <span className="text-[10px] text-teal font-mono font-bold">{fontSizeRem}rem</span>
                        </div>
                        <div className="flex items-center">
                          <input
                            type="range"
                            min="0.5"
                            max="4"
                            step="0.1"
                            value={fontSizeRem}
                            onChange={e => setFontSizeRem(Number(e.target.value))}
                            className="w-full accent-teal h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-txt-secondary mb-1">Text Color</label>
                        <div className="flex gap-2 items-center">
                          <input
                            type="color"
                            value={color}
                            onChange={e => setColor(e.target.value)}
                            className="w-8 h-8 rounded border border-border/80 cursor-pointer p-0 bg-transparent"
                          />
                          <input
                            type="text"
                            value={color}
                            onChange={e => setColor(e.target.value)}
                            className="input text-xs py-1 px-2 font-mono flex-1"
                            placeholder="#ffffff"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Side: Device Selection */}
                <div className="space-y-3 flex flex-col h-full justify-start">
                  <div>
                    <label className="block text-xs font-semibold text-txt-primary">Display on Screens</label>
                    <p className="text-[10px] text-txt-secondary mt-0.5">Select the screens where this widget overlay will be active</p>
                  </div>
                  <div className="space-y-2 border border-border/55 rounded-2xl p-4 bg-surface/35 overflow-y-auto max-h-[310px] flex-1">
                    {devices.map((d: any) => (
                      <label key={d.id} className="flex items-center gap-3 text-xs text-txt-secondary hover:text-txt-primary cursor-pointer py-1">
                        <input
                          type="checkbox"
                          checked={selectedDeviceIds.includes(d.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedDeviceIds([...selectedDeviceIds, d.id])
                            } else {
                              setSelectedDeviceIds(selectedDeviceIds.filter(id => id !== d.id))
                            }
                          }}
                          className="rounded border-border text-teal focus:ring-teal bg-card w-4 h-4"
                        />
                        <div className="flex flex-col">
                          <span className="font-medium text-txt-primary">{d.name}</span>
                          <span className="text-[10px] text-txt-muted">{d.location || 'No location set'}</span>
                        </div>
                      </label>
                    ))}
                    {devices.length === 0 && (
                      <p className="text-xs text-txt-muted italic py-6 text-center">No screens registered yet.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-border/40 pt-4 mt-2">
                <button type="button" onClick={closeForm} className="btn-ghost text-xs">
                  Cancel
                </button>
                <button type="submit" className="btn-primary text-xs px-6">
                  {editingWidget ? 'Save Changes' : 'Create Widget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared Visual Widget Preview Helpers ────────────────────────────────────────

const getWidgetPreviewStyle = (position: string, settingsObj: any): React.CSSProperties => {
  const base: React.CSSProperties = {
    position: 'absolute',
    zIndex: 10,
    pointerEvents: 'none',
    display: 'flex',
  }

  if (position === 'CUSTOM') {
    const top = settingsObj.customTop !== undefined ? settingsObj.customTop : 10
    const left = settingsObj.customLeft !== undefined ? settingsObj.customLeft : 10
    return {
      ...base,
      top: `${top}%`,
      left: `${left}%`,
      transform: 'translate(-50%, -50%)',
    }
  }

  switch (position) {
    case 'TOP_LEFT':
      return { ...base, top: '6px', left: '6px' }
    case 'TOP_RIGHT':
      return { ...base, top: '6px', right: '6px' }
    case 'BOTTOM_LEFT':
      return { ...base, bottom: '6px', left: '6px' }
    case 'BOTTOM_RIGHT':
      return { ...base, bottom: '6px', right: '6px' }
    case 'TOP_CENTER':
      return { ...base, top: '6px', left: '50%', transform: 'translateX(-50%)' }
    case 'BOTTOM_CENTER':
      return { ...base, bottom: '6px', left: '50%', transform: 'translateX(-50%)' }
    case 'CENTER':
      return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    case 'TOP_BAR':
      return { ...base, top: 0, left: 0, width: '100%' }
    case 'BOTTOM_BAR':
      return { ...base, bottom: 0, left: 0, width: '100%' }
    case 'LEFT_BAR':
      return { ...base, top: 0, left: 0, height: '100%', flexDirection: 'column' }
    case 'RIGHT_BAR':
      return { ...base, top: 0, right: 0, height: '100%', flexDirection: 'column' }
    default:
      return base
  }
}

function ClockWidgetPreview({ settings, scale = 1 }: { settings: any; scale?: number }) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const timeString = time.toLocaleTimeString([], {
    timeZone: settings.timezone || undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: settings.format !== '24h'
  })

  const dateString = time.toLocaleDateString([], {
    timeZone: settings.timezone || undefined,
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })

  return (
    <div 
      className="flex flex-col items-center justify-center p-2 rounded-xl backdrop-blur-md bg-black/45 border border-white/10 text-white shadow-lg pointer-events-none select-none origin-center" 
      style={{ 
        transform: `scale(${scale})`,
        fontSize: settings.fontSize || '0.95rem', 
        color: settings.color || '#ffffff' 
      }}
    >
      <div className="font-bold font-mono tracking-tight leading-none whitespace-nowrap">{timeString}</div>
      <div className="text-[0.55em] mt-0.5 opacity-75 font-semibold uppercase tracking-wider whitespace-nowrap">{dateString}</div>
    </div>
  )
}

function WeatherWidgetPreview({ settings, scale = 1 }: { settings: any; scale?: number }) {
  const unit = settings.unit === 'C' ? '°C' : '°F'
  const displayTemp = settings.unit === 'C' ? 22 : 72

  return (
    <div 
      className="flex items-center gap-2 p-2 rounded-xl backdrop-blur-md bg-black/45 border border-white/10 text-white shadow-lg pointer-events-none select-none origin-center" 
      style={{ 
        transform: `scale(${scale})`,
        fontSize: settings.fontSize || '0.85rem', 
        color: settings.color || '#ffffff' 
      }}
    >
      <span className="text-base leading-none">🌤️</span>
      <div className="flex flex-col justify-center">
        <span className="font-bold font-mono leading-none">{displayTemp}{unit}</span>
        <span className="text-[0.55em] mt-0.5 opacity-75 font-semibold uppercase tracking-wider leading-none truncate max-w-[80px]">{settings.city || 'Atlanta'}</span>
      </div>
    </div>
  )
}

function TickerWidgetPreview({ settings, scale = 1 }: { settings: any; scale?: number }) {
  return (
    <div 
      className="w-full overflow-hidden whitespace-nowrap py-1.5 flex items-center border-t border-b border-white/10 backdrop-blur-md pointer-events-none select-none origin-center" 
      style={{ 
        transform: `scale(${scale})`,
        backgroundColor: settings.bg || 'rgba(0,0,0,0.55)', 
        color: settings.color || '#ffffff', 
        fontSize: settings.fontSize || '0.75rem' 
      }}
    >
      <div 
        className="inline-block animate-widget-marquee pl-[100%]"
        style={{ 
          animationDuration: `${settings.speed || 15}s`,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite'
        }}
      >
        {settings.text || 'Welcome to Open Source Signage'}
      </div>
    </div>
  )
}
