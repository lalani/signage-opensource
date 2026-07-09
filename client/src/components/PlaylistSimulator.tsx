import { useState, useEffect, useRef } from 'react'

interface Content {
  id: string
  name: string
  type: string
  filePath?: string
  url?: string
  scale?: 'FIT' | 'FILL' | 'STRETCH'
  thumbnailPath?: string
  validFrom?: string | null
  validUntil?: string | null
}

interface PlaylistItem {
  id: string
  contentId: string
  durationSec: number
  orderIndex: number
  content: Content
  crossfade: boolean
}

interface PlaylistSimulatorProps {
  playlistName: string
  items: PlaylistItem[]
  onClose: () => void
}

export default function PlaylistSimulator({ playlistName, items: rawItems, onClose }: PlaylistSimulatorProps) {
  const items = rawItems.filter(item => {
    const content = item.content
    const now = new Date()
    if (content.validFrom && new Date(content.validFrom) > now) return false
    if (content.validUntil && new Date(content.validUntil) < now) return false
    return true
  })

  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [orientation, setOrientation] = useState<'LANDSCAPE' | 'PORTRAIT'>('LANDSCAPE')

  const timerRef = useRef<any>(null)
  const currentItem = items[currentIndex]

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

  const handlePrev = () => {
    setCurrentIndex((idx) => (idx - 1 + items.length) % items.length)
    setElapsed(0)
  }

  const handleNext = () => {
    setCurrentIndex((idx) => (idx + 1) % items.length)
    setElapsed(0)
  }

  if (items.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/90 backdrop-blur-sm p-4">
        <div className="card max-w-md w-full p-6 text-center space-y-4">
          <p className="text-sm text-txt-secondary">Add some content items to the playlist first to preview it.</p>
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      </div>
    )
  }

  const getMediaUrl = (content: Content) => {
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base/95 backdrop-blur-md text-txt-primary select-none font-sans">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-card">
        <div>
          <h2 className="text-base font-semibold">Preview Simulator</h2>
          <p className="text-xs text-txt-muted truncate max-w-xs sm:max-w-md">Playlist: {playlistName}</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-surface p-1 rounded-lg border border-border">
            <button
              onClick={() => setOrientation('LANDSCAPE')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                orientation === 'LANDSCAPE' ? 'bg-teal text-base shadow' : 'text-txt-secondary hover:text-txt-primary'
              }`}
            >
              🖥️ Landscape
            </button>
            <button
              onClick={() => setOrientation('PORTRAIT')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                orientation === 'PORTRAIT' ? 'bg-teal text-base shadow' : 'text-txt-secondary hover:text-txt-primary'
              }`}
            >
              📱 Portrait
            </button>
          </div>

          <button onClick={onClose} className="btn-ghost text-xs">
            Close
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Simulator Screen Container */}
        <div className="flex-1 flex items-center justify-center p-6 bg-black/40 overflow-hidden relative">
          <div
            className={`transition-all duration-300 bg-black flex items-center justify-center relative overflow-hidden rounded-xl shadow-2xl border border-white/10 ${
              orientation === 'LANDSCAPE'
                ? 'w-full max-w-4xl aspect-video'
                : 'h-[75vh] aspect-[9/16]'
            }`}
          >
            {/* Screen Content */}
            {currentItem && (
              <>
                {currentItem.content.type === 'IMAGE' && (
                  <img
                    key={currentItem.id}
                    src={getMediaUrl(currentItem.content)}
                    alt={currentItem.content.name}
                    className={`w-full h-full ${getObjectFitClass(currentItem.content.scale)}`}
                  />
                )}

                {currentItem.content.type === 'VIDEO' && (
                  <video
                    key={currentItem.id}
                    src={getMediaUrl(currentItem.content)}
                    autoPlay
                    muted
                    loop
                    className={`w-full h-full ${getObjectFitClass(currentItem.content.scale)}`}
                  />
                )}

                {(currentItem.content.type === 'WEB_URL' ||
                  currentItem.content.type === 'SLIDES_URL' ||
                  currentItem.content.type === 'CANVA_URL') && (
                  <iframe
                    key={currentItem.id}
                    src={currentItem.content.url}
                    className="w-full h-full border-none"
                    allow="autoplay"
                  />
                )}
              </>
            )}

            {/* Slide name overlay */}
            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg text-white text-xs select-none pointer-events-none">
              Slide {currentIndex + 1}: {currentItem?.content.name}
            </div>
          </div>
        </div>

        {/* Sidebar Checklist of slides */}
        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-border bg-card flex flex-col h-64 md:h-auto overflow-hidden">
          <div className="p-3 border-b border-border bg-surface">
            <span className="text-xs font-semibold uppercase tracking-wider text-txt-muted">Slides list</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {items.map((item, index) => (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentIndex(index)
                  setElapsed(0)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  index === currentIndex
                    ? 'bg-teal/15 border border-teal/20 text-teal'
                    : 'border border-transparent hover:bg-surface text-txt-secondary hover:text-txt-primary'
                }`}
              >
                <span className="font-mono text-xs">{index + 1}</span>
                {item.content.thumbnailPath ? (
                  <img
                    src={`/media/${item.content.thumbnailPath}`}
                    alt=""
                    className="w-12 h-7 object-cover rounded border border-border/20 flex-shrink-0"
                  />
                ) : (
                  <span className="w-12 h-7 rounded bg-surface border border-border flex items-center justify-center text-xs flex-shrink-0">
                    {item.content.type === 'IMAGE' ? '🖼️' : item.content.type === 'VIDEO' ? '🎬' : '🌐'}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{item.content.name}</p>
                  <p className="text-[10px] text-txt-muted">{item.durationSec}s</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Control Bar */}
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

        {/* Playback Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center text-txt-secondary hover:text-txt-primary transition-colors"
            title="Previous slide"
          >
            ⏮️
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-12 h-12 rounded-full bg-teal text-base flex items-center justify-center hover:bg-teal-dim shadow-lg shadow-teal/10 transition-colors"
            title={isPlaying ? 'Pause simulation' : 'Play simulation'}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>
          <button
            onClick={handleNext}
            className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center text-txt-secondary hover:text-txt-primary transition-colors"
            title="Next slide"
          >
            ⏭️
          </button>
        </div>

        {/* Counter Info */}
        <div className="text-xs text-txt-secondary">
          Slide <span className="font-semibold text-txt-primary">{currentIndex + 1}</span> of {items.length}
        </div>
      </div>
    </div>
  )
}
