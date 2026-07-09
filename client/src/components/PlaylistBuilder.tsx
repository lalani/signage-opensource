import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../lib/api'

import PlaylistSimulator from './PlaylistSimulator'

interface Content {
  id: string
  name: string
  type: string
  filePath?: string
  url?: string
  scale?: 'FIT' | 'FILL' | 'STRETCH'
  thumbnailPath?: string
  slideDuration?: number
  _count?: {
    slideImages: number
  }
}
interface PlaylistItem { id:string; contentId:string; durationSec:number; orderIndex:number; content:Content; crossfade:boolean }
interface Playlist { id:string; name:string; items:PlaylistItem[] }
interface Device { id:string; name:string; location?:string }

const TYPE_ICON: Record<string,string> = { IMAGE:'🖼', VIDEO:'🎬', SLIDES_URL:'📊', WEB_URL:'🌐' }

export default function PlaylistBuilder({ playlist, onClose }: { playlist:Playlist; onClose:()=>void }) {
  const qc      = useQueryClient()
  const sensors = useSensors(useSensor(PointerSensor))
  const [items, setItems] = useState<PlaylistItem[]>(playlist.items)
  const [dirty, setDirty] = useState(false)
  const [showDeploy, setShowDeploy] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [selectedDevices, setSelectedDevices] = useState<string[]>([])

  const { data: library = [] } = useQuery<Content[]>({
    queryKey: ['content'], queryFn: () => api.get('/content').then(r => r.data),
  })
  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices'], queryFn: () => api.get('/devices').then(r => r.data),
  })

  const save = useMutation({
    mutationFn: () => api.put(`/playlists/${playlist.id}/items`, {
      items: items.map(i => ({ contentId: i.contentId, durationSec: i.durationSec, crossfade: i.crossfade })),
    }),
    onSuccess: () => { qc.invalidateQueries({queryKey:['playlists']}); setDirty(false); toast.success('Saved') },
  })

  const deploy = useMutation({
    mutationFn: () => api.post(`/playlists/${playlist.id}/deploy`, { deviceIds: selectedDevices }),
    onSuccess: (r) => { toast.success(`Deployed to ${r.data.deployed} device(s)`); setShowDeploy(false) },
  })

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = items.findIndex(i => i.id === active.id)
    const to   = items.findIndex(i => i.id === over.id)
    setItems(arrayMove(items, from, to)); setDirty(true)
  }

  function addContent(c: Content) {
    const slideCount = c._count?.slideImages || 0
    const defaultDuration = (c.type === 'SLIDES_URL' || c.type === 'PDF') && slideCount > 0
      ? (c.slideDuration || 5) * slideCount
      : 10

    const newItem: PlaylistItem = {
      id: `tmp-${Date.now()}`, contentId: c.id, durationSec: defaultDuration,
      orderIndex: items.length, content: c, crossfade: true,
    }
    setItems([...items, newItem]); setDirty(true)
  }

  function remove(id: string) { setItems(items.filter(i => i.id !== id)); setDirty(true) }
  function setDur(id: string, v: number) {
    setItems(items.map(i => i.id === id ? {...i, durationSec: v} : i)); setDirty(true)
  }
  function toggleCrossfade(id: string) {
    setItems(items.map(i => i.id === id ? {...i, crossfade: !i.crossfade} : i)); setDirty(true)
  }

  function toggleDevice(id: string) {
    setSelectedDevices(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])
  }

  const [showLibrary, setShowLibrary] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex bg-base/80 backdrop-blur-sm">
      <div className="flex flex-1 overflow-hidden m-0 md:m-4 rounded-none md:rounded-2xl border-0 md:border border-border bg-surface shadow-2xl relative">

        {/* Left: content library — overlay on mobile, sidebar on desktop */}
        <div className={`
          ${showLibrary ? 'flex' : 'hidden'} md:flex
          absolute md:relative inset-0 md:inset-auto z-20
          w-full md:w-72 flex-shrink-0 border-r border-border flex-col bg-surface
        `}>
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Content library</p>
              <p className="text-xs text-txt-muted mt-0.5">Tap to add to playlist</p>
            </div>
            <button onClick={() => setShowLibrary(false)} className="md:hidden btn-ghost text-xs">Done</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {library.map(c => (
              <button key={c.id} onClick={() => { addContent(c); setShowLibrary(false) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-card text-left transition-colors">
                {c.thumbnailPath ? (
                  <img src={`/media/${c.thumbnailPath}`} alt="" className="w-12 h-7 object-cover rounded flex-shrink-0" />
                ) : (
                  <span className="text-base w-12 flex-shrink-0 text-center">{TYPE_ICON[c.type]??'📄'}</span>
                )}
                <span className="text-xs text-txt-secondary truncate">{c.name}</span>
              </button>
            ))}
            {library.length === 0 && <p className="text-xs text-txt-muted text-center py-8">No content yet</p>}
          </div>
        </div>

        {/* Center: playlist */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="p-3 md:p-4 border-b border-border flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate">{playlist.name}</p>
              <p className="text-xs text-txt-muted">{items.length} items · drag to reorder</p>
            </div>
            <div className="flex gap-1.5 md:gap-2 flex-shrink-0">
              <button onClick={() => setShowLibrary(true)} className="btn-ghost text-xs md:hidden">+ Add</button>
              {dirty && <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary text-xs">Save</button>}
              <button onClick={() => setShowPreview(true)} className="btn-ghost text-xs">👁️ Preview</button>
              <button onClick={() => setShowDeploy(true)} className="btn-ghost text-xs">Deploy →</button>
              <button onClick={onClose} className="btn-ghost text-xs">Close</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 md:p-4">
            {items.length === 0 ? (
              <div className="h-full flex items-center justify-center text-txt-muted text-sm text-center px-4">
                <span className="hidden md:inline">← Click content to add items</span>
                <span className="md:hidden">Tap "+ Add" above to add items</span>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map(i=>i.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <SortableItem key={item.id} item={item} index={idx}
                        onRemove={() => remove(item.id)}
                        onDuration={(v) => setDur(item.id, v)}
                        onCrossfade={() => toggleCrossfade(item.id)} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* Deploy panel — overlay on mobile, sidebar on desktop */}
        {showDeploy && (
          <div className="
            flex absolute md:relative inset-0 md:inset-auto z-20
            w-full md:w-64 flex-shrink-0 border-l border-border flex-col bg-surface
          ">
            <div className="p-4 border-b border-border">
              <p className="text-sm font-medium">Deploy to devices</p>
              <p className="text-xs text-txt-muted mt-0.5">Select one or many</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {devices.map(d => (
                <label key={d.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-card cursor-pointer">
                  <input type="checkbox" checked={selectedDevices.includes(d.id)}
                    onChange={() => toggleDevice(d.id)} className="accent-teal" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{d.name}</p>
                    {d.location && <p className="text-xs text-txt-muted truncate">{d.location}</p>}
                  </div>
                </label>
              ))}
            </div>
            <div className="p-3 border-t border-border space-y-2">
              <button onClick={() => deploy.mutate()} disabled={!selectedDevices.length||deploy.isPending}
                className="btn-primary w-full text-xs">
                {deploy.isPending ? 'Deploying…' : `Deploy to ${selectedDevices.length} device(s)`}
              </button>
              <button onClick={() => setShowDeploy(false)} className="btn-ghost w-full text-xs">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {showPreview && (
        <PlaylistSimulator
          playlistName={playlist.name}
          items={items}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}

function SortableItem({ item, index, onRemove, onDuration, onCrossfade }: {
  item: PlaylistItem; index: number
  onRemove: () => void; onDuration: (v:number) => void; onCrossfade: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const isSlides = item.content.type === 'SLIDES_URL' || item.content.type === 'PDF'
  const slideCount = item.content._count?.slideImages || 0
  const slideDuration = item.content.slideDuration || 5
  const calculatedDuration = slideCount * slideDuration

  return (
    <div ref={setNodeRef} style={style}
      className="card flex items-center gap-2 sm:gap-3 group hover:border-border/80">
      <span {...attributes} {...listeners} className="text-txt-muted cursor-grab active:cursor-grabbing select-none px-1 touch-none">⠿</span>
      <span className="hidden sm:inline text-xs font-mono text-txt-muted w-5">{index+1}</span>
      {item.content.thumbnailPath ? (
        <img src={`/media/${item.content.thumbnailPath}`} alt="" className="w-10 h-6 object-cover rounded flex-shrink-0" />
      ) : (
        <span className="text-base flex-shrink-0">{TYPE_ICON[item.content.type]??'📄'}</span>
      )}
      <span className="flex-1 text-sm truncate">{item.content.name}</span>

      {/* Crossfade Toggle */}
      <button onClick={onCrossfade}
        title={item.crossfade ? 'Crossfade enabled' : 'Crossfade disabled'}
        className="flex items-center gap-1 flex-shrink-0 group">
        <span className="text-[10px] text-txt-muted group-hover:text-txt-secondary transition-colors hidden md:inline">Crossfade</span>
        <div className={`w-8 h-4 rounded-full relative transition-colors flex-shrink-0 ${item.crossfade ? 'bg-teal' : 'bg-border'}`}>
          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${item.crossfade ? 'translate-x-3' : 'translate-x-0.5'}`} />
        </div>
      </button>

      {/* Duration Control */}
      {isSlides && slideCount > 0 ? (
        <div className="flex items-center gap-2 flex-shrink-0 text-xs">
          <div className="text-txt-secondary inline-flex items-center gap-1.5">
            <span>{slideCount} slides × {slideDuration}s</span>
            <button
              onClick={() => onDuration(calculatedDuration)}
              disabled={item.durationSec === calculatedDuration}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                item.durationSec === calculatedDuration
                  ? 'border-teal/20 text-teal bg-teal/10 pointer-events-none'
                  : 'border-border text-txt-muted hover:text-txt-primary hover:border-border/80'
              }`}
              title="Apply auto-calculated duration"
            >
              Auto
            </button>
          </div>
          <div className="flex items-center gap-1">
            <input type="number" min={1} max={3600} value={item.durationSec}
              onChange={e => onDuration(Number(e.target.value))}
              title="Edit to manually override duration"
              className={`w-14 sm:w-16 bg-surface border rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:border-teal ${
                item.durationSec !== calculatedDuration ? 'border-amber/50 focus:border-amber text-amber' : 'border-border'
              }`} />
            <span className="text-xs text-txt-muted">s</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1 flex-shrink-0">
          <input type="number" min={1} max={3600} value={item.durationSec}
            onChange={e => onDuration(Number(e.target.value))}
            className="w-14 sm:w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:border-teal" />
          <span className="text-xs text-txt-muted">s</span>
        </div>
      )}

      <button onClick={onRemove} className="text-txt-muted hover:text-coral opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-xs px-1">✕</button>
    </div>
  )
}
