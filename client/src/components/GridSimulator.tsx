import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

interface GridDevice {
  id: string
  name: string
  gridRow: number | null
  gridCol: number | null
}

interface DeviceGrid {
  id: string
  name: string
  rows: number
  cols: number
  devices: GridDevice[]
}

interface GridSimulatorProps {
  grid: DeviceGrid
  playlists: any[]
  onClose: () => void
}

export default function GridSimulator({ grid, playlists, onClose }: GridSimulatorProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(playlists[0]?.id || '')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [elapsed, setElapsed] = useState(0)

  const timerRef = useRef<any>(null)

  // Fetch selected playlist details
  const { data: playlistDetails, isLoading } = useQuery({
    queryKey: ['playlist-detail', selectedPlaylistId],
    queryFn: () => api.get(`/playlists/${selectedPlaylistId}`).then(r => r.data),
    enabled: !!selectedPlaylistId
  })

  const items = playlistDetails?.items || []
  const currentItem = items[currentIndex]

  useEffect(() => {
    setCurrentIndex(0)
    setElapsed(0)
  }, [selectedPlaylistId])

  useEffect(() => {
    if (!isPlaying || items.length === 0) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    const duration = currentItem?.durationSec || 10
    setElapsed(0)

    const interval = setInterval(() => {
      setElapsed((prev) => {
        if (prev + 1 >= duration) {
          setCurrentIndex((idx) => (idx + 1) % items.length)
          return 0
        }
        return prev + 1
      })
    }, 1000)

    timerRef.current = interval
    return () => clearInterval(interval)
  }, [currentIndex, isPlaying, items, currentItem])

  const getMediaUrl = (content: any) => {
    if (content.filePath) {
      return `/media/${content.filePath}`
    }
    return content.url || ''
  }

  const getObjectFitClass = (scale?: string) => {
    if (scale === 'FILL') return 'object-cover'
    if (scale === 'STRETCH') return 'object-fill'
    return 'object-contain'
  }

  const getSlicedMediaStyle = (r: number, c: number) => {
    return {
      width: `${grid.cols * 100}%`,
      height: `${grid.rows * 100}%`,
      transform: `translate(${-c * 100}%, ${-r * 100}%)`,
      transformOrigin: 'top left',
      position: 'absolute' as const,
      top: 0,
      left: 0,
      maxWidth: 'none',
      maxHeight: 'none',
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base/95 backdrop-blur-md text-txt-primary select-none font-sans">
      {/* Header */}
      <div className="p-4 border-b border-border flex flex-col sm:flex-row items-center gap-4 justify-between bg-card">
        <div>
          <h2 className="text-base font-semibold">Video Wall Grid Simulator</h2>
          <p className="text-xs text-txt-muted truncate max-w-xs sm:max-w-md">Grid: {grid.name}</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-txt-secondary">Select Playlist:</span>
            <select
              value={selectedPlaylistId}
              onChange={e => setSelectedPlaylistId(e.target.value)}
              className="bg-surface border border-border text-txt-primary text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-teal"
            >
              {playlists.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              {playlists.length === 0 && <option value="">No playlists available</option>}
            </select>
          </div>

          <button onClick={onClose} className="btn-ghost text-xs">
            Close
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-black/40 overflow-hidden">
        {isLoading ? (
          <p className="text-xs text-txt-muted">Loading playlist content...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-txt-muted italic">Playlist is empty or select another one.</p>
        ) : (
          <div
            className="grid gap-2 p-4 border border-white/10 rounded-2xl bg-black/50 overflow-auto shadow-2xl"
            style={{
              gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
              gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
              width: '100%',
              maxWidth: '850px',
              aspectRatio: `${(16 * grid.cols) / (9 * grid.rows)}`
            }}
          >
            {Array.from({ length: grid.rows }).map((_, r) =>
              Array.from({ length: grid.cols }).map((_, c) => {
                const deviceInCell = grid.devices.find(d => d.gridRow === r && d.gridCol === c)
                return (
                  <div
                    key={`${r}-${c}`}
                    className="relative overflow-hidden aspect-video bg-black rounded-lg border border-white/15 shadow-md flex items-center justify-center"
                  >
                    {currentItem && (
                      <>
                        {currentItem.content.type === 'IMAGE' && (
                          <img
                            key={currentItem.id}
                            src={getMediaUrl(currentItem.content)}
                            alt=""
                            className={getObjectFitClass(currentItem.content.scale)}
                            style={getSlicedMediaStyle(r, c)}
                          />
                        )}

                        {currentItem.content.type === 'VIDEO' && (
                          <video
                            key={currentItem.id}
                            src={getMediaUrl(currentItem.content)}
                            autoPlay
                            muted
                            loop
                            className={getObjectFitClass(currentItem.content.scale)}
                            style={getSlicedMediaStyle(r, c)}
                          />
                        )}

                        {(currentItem.content.type === 'WEB_URL' ||
                          currentItem.content.type === 'SLIDES_URL' ||
                          currentItem.content.type === 'CANVA_URL') && (
                          <iframe
                            key={currentItem.id}
                            src={currentItem.content.url}
                            className="border-none"
                            style={getSlicedMediaStyle(r, c)}
                            allow="autoplay"
                          />
                        )}
                      </>
                    )}

                    {/* Cell coordinate badge */}
                    <div className="absolute top-2 left-2 bg-black/60 border border-white/10 px-2 py-0.5 rounded text-[9px] font-mono text-white pointer-events-none z-10">
                      R{r+1} C{c+1} {deviceInCell ? `(${deviceInCell.name})` : '(Empty)'}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Control Bar */}
      {items.length > 0 && !isLoading && (
        <div className="p-4 border-t border-border bg-card flex flex-col sm:flex-row items-center gap-4 justify-between">
          {/* Playback Progress */}
          <div className="w-full sm:w-1/3 flex items-center gap-3">
            <span className="text-xs font-mono text-txt-muted">{elapsed}s</span>
            <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-teal transition-all duration-1000 ease-linear"
                style={{
                  width: `${(elapsed / (currentItem?.durationSec || 10)) * 100}%`,
                }}
              />
            </div>
            <span className="text-xs font-mono text-txt-secondary">
              {currentItem?.durationSec || 10}s
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCurrentIndex((idx) => (idx - 1 + items.length) % items.length)
                setElapsed(0)
              }}
              className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center text-txt-secondary hover:text-txt-primary transition-colors"
            >
              ⏮️
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-12 h-12 rounded-full bg-teal text-base flex items-center justify-center hover:bg-teal-dim shadow-lg transition-colors"
            >
              {isPlaying ? '⏸️' : '▶️'}
            </button>
            <button
              onClick={() => {
                setCurrentIndex((idx) => (idx + 1) % items.length)
                setElapsed(0)
              }}
              className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center text-txt-secondary hover:text-txt-primary transition-colors"
            >
              ⏭️
            </button>
          </div>

          <div className="text-xs text-txt-secondary">
            Slide <span className="font-semibold text-txt-primary">{currentIndex + 1}</span> of {items.length} (Active: {currentItem?.content.name})
          </div>
        </div>
      )}
    </div>
  )
}
