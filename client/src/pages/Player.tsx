import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import api from '../lib/api'

export default function Player() {
  const [regKey, setRegKey] = useState<string | null>(localStorage.getItem('device_registration_key'))
  const [pairCode, setPairCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playlist, setPlaylist] = useState<any>(() => {
    try {
      const cached = localStorage.getItem('cached_playlist')
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [grid, setGrid] = useState<any>(null)
  const [trialExpired, setTrialExpired] = useState(false)
  const [splashUrl, setSplashUrl] = useState<string | null>(() => localStorage.getItem('cached_splash_url'))
  const [deviceOrientation, setDeviceOrientation] = useState<string>(() => localStorage.getItem('cached_orientation') || 'LANDSCAPE')
  const [widgets, setWidgets] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem('cached_widgets')
      return cached ? JSON.parse(cached) : []
    } catch {
      return []
    }
  })
  const [itemOffset, setItemOffset] = useState<number>(0)
  const socketRef = useRef<Socket | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // 1. Pairing Flow (if no registration key exists)
  useEffect(() => {
    if (regKey) return

    let pollInterval: any

    async function startPairing() {
      try {
        const { data } = await api.post('/devices/pair/code')
        setPairCode(data.code)

        // Poll for registration status
        pollInterval = setInterval(async () => {
          try {
            const res = await api.get(`/devices/pair/status?code=${data.code}`)
            if (res.data.registered && res.data.registrationKey) {
              clearInterval(pollInterval)
              localStorage.setItem('device_registration_key', res.data.registrationKey)
              setRegKey(res.data.registrationKey)
            }
          } catch (err) {
            console.error('Polling error:', err)
          }
        }, 3000)
      } catch (err) {
        setError('Failed to initialize pairing session. Retrying...')
        setTimeout(startPairing, 5000)
      }
    }

    startPairing()

    return () => {
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [regKey])

  // 2. Playback / Socket Connection Flow
  useEffect(() => {
    if (!regKey) return

    const PLAYER_VERSION = '1.2.0'
    const socket = io(window.location.origin)
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('Connected to server as Web Player')
      socket.emit('device:hello', { registrationKey: regKey, version: PLAYER_VERSION })
    })

    socket.on('cmd:play', (payload) => {
      console.log('Received playlist payload:', payload)
      setPlaylist(payload)
      setCurrentIndex(0)
      if (payload) {
        localStorage.setItem('cached_playlist', JSON.stringify(payload))
      }
    })

    socket.on('cmd:restart', () => {
      window.location.reload()
    })

    socket.on('cmd:reboot', () => {
      window.location.reload()
    })

    socket.on('cmd:settings', (settings) => {
      console.log('Received settings:', settings)
      if (settings.grid) {
        setGrid(settings.grid)
      } else {
        setGrid(null)
      }
      if (settings.widgets) {
        setWidgets(settings.widgets)
        localStorage.setItem('cached_widgets', JSON.stringify(settings.widgets))
      }
      if (settings.trialExpired !== undefined) {
        setTrialExpired(settings.trialExpired)
      }
      if (settings.splashUrl !== undefined) {
        setSplashUrl(settings.splashUrl)
        if (settings.splashUrl) {
          localStorage.setItem('cached_splash_url', settings.splashUrl)
        } else {
          localStorage.removeItem('cached_splash_url')
        }
      }
      if (settings.orientation !== undefined) {
        setDeviceOrientation(settings.orientation)
        localStorage.setItem('cached_orientation', settings.orientation)
      }
    })

    socket.on('error', (err) => {
      console.error('Socket error:', err)
      if (err === 'Unknown registration key') {
        localStorage.removeItem('device_registration_key')
        setRegKey(null)
      }
    })

    // Send heartbeat every 15 seconds
    const heartbeatInterval = setInterval(() => {
      socket.emit('device:heartbeat', {
        cpuUsage: 0,
        cpuTemp: 0,
        memUsage: 0,
        diskUsage: 0,
        uptime: Math.round(performance.now() / 1000)
      })
    }, 15000)

    return () => {
      socket.disconnect()
      clearInterval(heartbeatInterval)
    }
  }, [regKey])

  // 3. Slideshow Rotation & Synchronization
  useEffect(() => {
    if (!playlist || !playlist.items || playlist.items.length === 0) return

    if (grid) {
      const interval = setInterval(() => {
        const totalDuration = playlist.items.reduce((acc: number, item: any) => acc + (item.durationSec || 10), 0)
        if (totalDuration === 0) return

        const now = Date.now()
        const startOfDay = new Date().setUTCHours(0, 0, 0, 0)
        const elapsedSeconds = (now - startOfDay) / 1000
        const currentCycleTime = elapsedSeconds % totalDuration

        let accumulatedTime = 0
        let targetIndex = 0
        let progressSec = 0

        for (let i = 0; i < playlist.items.length; i++) {
          const itemDuration = playlist.items[i].durationSec || 10
          if (currentCycleTime >= accumulatedTime && currentCycleTime < accumulatedTime + itemDuration) {
            targetIndex = i
            progressSec = currentCycleTime - accumulatedTime
            break
          }
          accumulatedTime += itemDuration
        }

        if (currentIndex !== targetIndex) {
          setCurrentIndex(targetIndex)
        }
        setItemOffset(progressSec)
      }, 1000)

      return () => clearInterval(interval)
    } else {
      const currentItem = playlist.items[currentIndex]
      const duration = currentItem.durationSec || 10

      const timer = setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % playlist.items.length)
      }, duration * 1000)

      return () => clearTimeout(timer)
    }
  }, [playlist, currentIndex, grid])

  // 4. Video Playback Synchronization & Drift Check
  useEffect(() => {
    if (!grid || !videoRef.current || itemOffset === undefined) return
    const video = videoRef.current
    if (video.duration) {
      const expectedTime = itemOffset % video.duration
      if (Math.abs(video.currentTime - expectedTime) > 0.5) {
        video.currentTime = expectedTime
      }
    }
  }, [itemOffset, grid])

  const handleVideoLoaded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!grid) return
    const video = e.currentTarget
    if (video.duration) {
      video.currentTime = itemOffset % video.duration
    }
  }

  const getMediaStyle = () => {
    if (!grid) return { width: '100%', height: '100%' }
    return {
      width: `${grid.cols * 100}%`,
      height: `${grid.rows * 100}%`,
      transform: `translate(${-grid.col * 100}%, ${-grid.row * 100}%)`,
      transformOrigin: 'top left',
      position: 'absolute' as const,
      top: 0,
      left: 0,
      maxWidth: 'none',
      maxHeight: 'none',
    }
  }

  const getOrientationStyle = (): React.CSSProperties => {
    const isViewportLandscape = window.innerWidth > window.innerHeight
    
    let rotation = 0
    let width = '100vw'
    let height = '100vh'

    if (deviceOrientation === 'PORTRAIT') {
      if (isViewportLandscape) {
        rotation = 90
        width = '100vh'
        height = '100vw'
      }
    } else if (deviceOrientation === 'PORTRAIT_FLIPPED') {
      if (isViewportLandscape) {
        rotation = 270
        width = '100vh'
        height = '100vw'
      } else {
        rotation = 180
      }
    } else if (deviceOrientation === 'LANDSCAPE_FLIPPED') {
      if (isViewportLandscape) {
        rotation = 180
      } else {
        rotation = 270
        width = '100vh'
        height = '100vw'
      }
    } else { // LANDSCAPE
      if (!isViewportLandscape) {
        rotation = 90
        width = '100vh'
        height = '100vw'
      }
    }

    if (rotation === 0) {
      return {
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
      }
    }

    return {
      width,
      height,
      transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
      transformOrigin: 'center',
      position: 'absolute',
      top: '50%',
      left: '50%',
      overflow: 'hidden',
    }
  }

  if (error && !pairCode) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center p-6 text-txt-primary">
        <p className="text-coral font-medium">{error}</p>
      </div>
    )
  }

  // Render Pairing screen if no registration key
  if (!regKey) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center p-6 text-txt-primary font-sans select-none">
        <div className="w-full max-w-lg text-center space-y-8">
          <div className="space-y-3">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-glow border border-teal/30 mb-2">
              <span className="text-teal text-2xl font-bold font-mono">S</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Signage by TableView Media</h1>
            <p className="text-txt-secondary text-sm">Web Player Setup</p>
          </div>

          <div className="card p-8 space-y-6 bg-surface border border-border/80 shadow-2xl rounded-2xl">
            <p className="text-xs uppercase font-bold tracking-wider text-txt-muted">Pairing Code</p>
            {pairCode ? (
              <div className="flex justify-center gap-3">
                {pairCode.split('').map((char, index) => (
                  <span key={index} className="w-12 h-16 flex items-center justify-center bg-base border border-border/60 text-3xl font-bold font-mono rounded-xl text-teal shadow-md">
                    {char}
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex justify-center items-center h-16">
                <svg className="animate-spin h-8 w-8 text-teal" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            )}

            <div className="text-left space-y-3 text-xs text-txt-secondary border-t border-border/40 pt-6">
              <p className="font-semibold text-txt-primary">To connect this screen:</p>
              <ol className="list-decimal pl-4 space-y-2">
                <li>Open the dashboard on another device (phone/laptop).</li>
                <li>Go to the <span className="text-txt-primary font-medium">Devices</span> tab and click <span className="text-teal font-medium">+ Add device</span>.</li>
                <li>Choose <span className="text-txt-primary font-medium">Web Player (Firestick)</span> and enter the code above.</li>
              </ol>
            </div>
          </div>
          
          <p className="text-[10px] text-txt-muted">
            URL: <span className="font-mono text-txt-secondary">{window.location.origin}/player</span>
          </p>
        </div>
      </div>
    )
  }

  // Render Loader if no playlist assigned yet
  if (trialExpired) {
    return (
      <div className="w-screen h-screen bg-black flex flex-col items-center justify-center text-white select-none relative p-6">
        {splashUrl && (
          <img
            src={splashUrl}
            alt="Splash Background"
            className="absolute inset-0 w-full h-full object-cover opacity-20 filter blur-sm"
          />
        )}
        <div className="z-10 flex flex-col items-center justify-center text-center max-w-lg space-y-6">
          <div className="w-20 h-20 rounded-3xl bg-amber-glow/10 border border-amber/20 flex items-center justify-center text-4xl shadow-2xl animate-pulse">
            ⏳
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Trial Expired</h1>
            <p className="text-sm text-txt-secondary leading-relaxed">
              This display is currently deactivated because your organization's 30-day trial has expired.
            </p>
          </div>
          <div className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-2xl text-xs text-txt-secondary font-mono">
            Please contact your administrator to upgrade your account.
          </div>
        </div>
      </div>
    )
  }

  if (!playlist || !playlist.items || playlist.items.length === 0) {
    return (
      <div className="w-screen h-screen bg-black flex flex-col items-center justify-center text-white select-none relative p-6">
        {splashUrl ? (
          <img
            src={splashUrl}
            alt="Splash"
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-4 border-t-teal border-r-border border-b-border border-l-border animate-spin" />
            <p className="text-sm text-txt-muted">Open Source Signage</p>
          </div>
        )}
      </div>
    )
  }

  const currentItem = playlist.items[currentIndex]
  const content = currentItem.content

  const getWidgetStyle = (position: string, parsedSettings: any): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: 50,
      pointerEvents: 'none',
      display: 'flex',
    }

    if (position === 'CUSTOM') {
      const customTop = parsedSettings?.customTop !== undefined ? parsedSettings.customTop : 10
      const customLeft = parsedSettings?.customLeft !== undefined ? parsedSettings.customLeft : 10
      return {
        ...base,
        top: `${customTop}%`,
        left: `${customLeft}%`,
        transform: 'translate(-50%, -50%)',
      }
    }

    switch (position) {
      case 'TOP_LEFT':
        return { ...base, top: '1.5rem', left: '1.5rem' }
      case 'TOP_RIGHT':
        return { ...base, top: '1.5rem', right: '1.5rem' }
      case 'BOTTOM_LEFT':
        return { ...base, bottom: '1.5rem', left: '1.5rem' }
      case 'BOTTOM_RIGHT':
        return { ...base, bottom: '1.5rem', right: '1.5rem' }
      case 'TOP_CENTER':
        return { ...base, top: '1.5rem', left: '50%', transform: 'translateX(-50%)' }
      case 'BOTTOM_CENTER':
        return { ...base, bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)' }
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

  return (
    <div className="w-screen h-screen overflow-hidden bg-black flex items-center justify-center select-none cursor-none relative">
      <style>{`
        @keyframes marquee {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-100%, 0, 0); }
        }
        .animate-marquee {
          animation: marquee linear infinite;
        }
      `}</style>

      <div style={getOrientationStyle()}>
        {content.type === 'IMAGE' && (
          <img
            key={content.id}
            src={content.fileUrl}
            alt={content.name}
            style={getMediaStyle()}
            className={`${
              content.scale === 'FILL' ? 'object-cover' : content.scale === 'STRETCH' ? 'object-fill' : 'object-contain'
            }`}
          />
        )}

        {content.type === 'VIDEO' && (
          <video
            key={content.id}
            ref={videoRef}
            onLoadedMetadata={handleVideoLoaded}
            src={content.fileUrl}
            autoPlay
            loop={playlist.items.length === 1}
            muted={content.muted !== false}
            style={getMediaStyle()}
            className={`${
              content.scale === 'FILL' ? 'object-cover' : content.scale === 'STRETCH' ? 'object-fill' : 'object-contain'
            }`}
          />
        )}

        {(content.type === 'WEB_URL' || content.type === 'SLIDES_URL' || content.type === 'CANVA_URL') && (
          <iframe
            key={content.id}
            src={content.url}
            style={getMediaStyle()}
            className="border-none"
            allow="autoplay"
          />
        )}

        {/* Render Overlay Widgets */}
        {widgets.map((w: any) => {
          let parsedSettings = {}
          try {
            parsedSettings = typeof w.settings === 'string' ? JSON.parse(w.settings) : w.settings
          } catch (e) {
            console.error('Failed to parse widget settings:', e)
          }

          const style = getWidgetStyle(w.position, parsedSettings)
          return (
            <div key={w.id} style={style}>
              {w.type === 'CLOCK' && <ClockWidget settings={parsedSettings} />}
              {w.type === 'WEATHER' && <WeatherWidget settings={parsedSettings} />}
              {w.type === 'TICKER' && <TickerWidget settings={parsedSettings} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Widget Helper Components ──────────────────────────────────────────────────

function ClockWidget({ settings }: { settings: any }) {
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
    <div className="flex flex-col items-center justify-center p-3.5 rounded-2xl backdrop-blur-md bg-black/45 border border-white/10 text-white shadow-2xl" style={{ fontSize: settings.fontSize || '1.4rem', color: settings.color || '#ffffff' }}>
      <div className="font-bold font-mono tracking-tight leading-none">{timeString}</div>
      <div className="text-[0.55em] mt-1 opacity-75 font-semibold uppercase tracking-wider">{dateString}</div>
    </div>
  )
}

function WeatherWidget({ settings }: { settings: any }) {
  const [weather, setWeather] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchWeather() {
      const city = settings.city || 'Atlanta'
      try {
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`)
        const geoData = await geoRes.json()
        if (geoData.results && geoData.results[0]) {
          const { latitude, longitude, name } = geoData.results[0]
          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`)
          const weatherData = await weatherRes.json()
          if (weatherData.current_weather) {
            setWeather({
              temp: Math.round(weatherData.current_weather.temperature),
              code: weatherData.current_weather.weathercode,
              city: name
            })
          }
        }
      } catch (err) {
        console.error('Weather fetch error:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchWeather()
    const interval = setInterval(fetchWeather, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [settings.city])

  if (loading) {
    return (
      <div className="p-3 rounded-xl backdrop-blur-md bg-black/40 border border-white/10 text-white text-xs">
        Loading weather...
      </div>
    )
  }

  if (!weather) return null

  const getIcon = (code: number) => {
    if (code === 0) return '☀️'
    if (code <= 3) return '🌤️'
    if (code <= 48) return '🌫️'
    if (code <= 67) return '🌧️'
    if (code <= 77) return '❄️'
    if (code <= 82) return '🌧️'
    if (code <= 99) return '⛈️'
    return '☀️'
  }

  const unit = settings.unit === 'C' ? '°C' : '°F'
  const displayTemp = settings.unit === 'C' ? weather.temp : Math.round((weather.temp * 9/5) + 32)

  return (
    <div className="flex items-center gap-3.5 p-3.5 rounded-2xl backdrop-blur-md bg-black/45 border border-white/10 text-white shadow-2xl" style={{ fontSize: settings.fontSize || '1.2rem', color: settings.color || '#ffffff' }}>
      <span className="text-2xl leading-none">{getIcon(weather.code)}</span>
      <div className="flex flex-col justify-center">
        <span className="font-bold font-mono leading-none">{displayTemp}{unit}</span>
        <span className="text-[0.55em] mt-1 opacity-75 font-semibold uppercase tracking-wider leading-none">{weather.city}</span>
      </div>
    </div>
  )
}

function TickerWidget({ settings }: { settings: any }) {
  return (
    <div 
      className="w-full overflow-hidden whitespace-nowrap py-2.5 flex items-center border-t border-b border-white/10 backdrop-blur-md" 
      style={{ 
        backgroundColor: settings.bg || 'rgba(0,0,0,0.55)', 
        color: settings.color || '#ffffff', 
        fontSize: settings.fontSize || '1.1rem' 
      }}
    >
      <div 
        className="inline-block animate-marquee pl-[100%]"
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
