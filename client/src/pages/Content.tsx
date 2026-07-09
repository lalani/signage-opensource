import { useRef, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../lib/api'

interface Content {
  id: string; name: string; type: string
  mimeType?: string; fileSize?: number; url?: string
  filePath?: string; thumbnailPath?: string
  muted?: boolean; scale?: 'FIT' | 'FILL' | 'STRETCH'; createdAt: string
  validFrom?: string | null
  validUntil?: string | null
  slideDuration?: number
  _count?: {
    slideImages: number
  }
}

function formatBytes(b: number) {
  if (b < 1024)        return `${b} B`
  if (b < 1024 ** 2)   return `${(b/1024).toFixed(1)} KB`
  return `${(b/1024**2).toFixed(1)} MB`
}

const TYPE_ICON: Record<string, string> = { IMAGE: '🖼', VIDEO: '🎬', SLIDES_URL: '📊', WEB_URL: '🌐', CANVA_URL: '🎨', PDF: '📁' }
const URL_TYPES = ['SLIDES_URL', 'WEB_URL', 'CANVA_URL']

function thumbUrl(item: Content) {
  if (item.thumbnailPath) return `/media/${item.thumbnailPath}`
  return null
}

function previewUrl(item: Content) {
  if (item.url) return item.url
  if (item.filePath) return `/media/${item.filePath}`
  return null
}

export default function Content() {
  const qc  = useQueryClient()
  const ref = useRef<HTMLInputElement>(null)

  const [urlName, setUrlName]     = useState('')
  const [urlVal,  setUrlVal]      = useState('')
  const [urlType, setUrlType]     = useState<'SLIDES_URL'|'WEB_URL'|'CANVA_URL'>('SLIDES_URL')
  const [slideDuration, setSlideDuration] = useState(5)
  const [showUrl, setShowUrl]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing]     = useState<Content | null>(null)
  const [previewing, setPreviewing] = useState<Content | null>(null)
  const [dragging, setDragging]   = useState(false)

  const { data: items = [] } = useQuery<Content[]>({
    queryKey: ['content'],
    queryFn:  () => api.get('/content').then(r => r.data),
  })

  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return
    setUploading(true)
    let ok = 0
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append('file', file); fd.append('name', file.name)
      try {
        await api.post('/content/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        ok++
      } catch { toast.error(`Failed: ${file.name}`) }
    }
    if (ok) toast.success(`Uploaded ${ok} file${ok > 1 ? 's' : ''}`)
    qc.invalidateQueries({ queryKey: ['content'] })
    setUploading(false)
  }

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(true)
  }, [])
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
  }, [])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    upload(e.dataTransfer.files)
  }, [])

  const addUrl = useMutation({
    mutationFn: () => api.post('/content/url', {
      name: urlName,
      url: urlVal,
      type: urlType,
      slideDuration: urlType === 'SLIDES_URL' ? slideDuration : undefined
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content'] })
      setUrlName('')
      setUrlVal('')
      setSlideDuration(5)
      setShowUrl(false)
      toast.success('Added')
    },
    onError: () => toast.error('Failed — check the URL is valid'),
  })

  const syncSlides = useMutation({
    mutationFn: (id: string) => api.post(`/content/${id}/sync`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['content'] })
      if (res.data.updated) {
        toast.success('Google Slides successfully synced!')
      } else {
        toast.success('Google Slides already up-to-date.')
      }
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Sync failed'),
  })

  const update = useMutation({
    mutationFn: (vars: { id: string; data: object }) => api.patch(`/content/${vars.id}`, vars.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['content'] }); toast.success('Updated'); setEditing(null) },
    onError: () => toast.error('Update failed'),
  })

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/content/${id}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['content'] }); qc.invalidateQueries({ queryKey: ['playlists'] })
      const n = res.data?.removedFromPlaylists ?? 0
      toast.success(n > 0 ? `Removed — also cleared from ${n} playlist(s)` : 'Removed')
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to remove'),
  })

  return (
    <div className="space-y-6" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-semibold">Content library</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowUrl(!showUrl)} className="btn-ghost flex-1 sm:flex-initial">+ URL / Slides / Canva</button>
          <button onClick={() => ref.current?.click()} disabled={uploading} className="btn-primary flex-1 sm:flex-initial">
            {uploading ? 'Uploading…' : '+ Upload file'}
          </button>
          <input ref={ref} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={e => upload(e.target.files)} />
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`relative border-2 border-dashed rounded-xl px-6 py-8 text-center transition-all cursor-pointer
          ${dragging ? 'border-teal bg-teal-glow scale-[1.01]' : 'border-border hover:border-border/60'}
          ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={() => !uploading && ref.current?.click()}
      >
        <div className="text-3xl mb-2">{dragging ? '📥' : uploading ? '⏳' : '🖼️'}</div>
        <p className="text-sm font-medium">{dragging ? 'Drop to upload' : uploading ? 'Uploading…' : 'Drag & drop files here'}</p>
        <p className="text-xs text-txt-muted mt-1">PNG · JPG · GIF · WebP · MP4 · MOV · WebM · PDF · up to 512 MB</p>
      </div>

      {/* URL form */}
      {showUrl && (
        <div className="card max-w-md space-y-3">
          <h2 className="font-medium text-sm">Add URL</h2>
          <select className="input" value={urlType} onChange={e => setUrlType(e.target.value as any)}>
            <option value="SLIDES_URL">Google Slides</option>
            <option value="CANVA_URL">Canva</option>
            <option value="WEB_URL">Web URL</option>
          </select>
          <input className="input" placeholder="Display name" value={urlName} onChange={e => setUrlName(e.target.value)} />
          <input className="input" placeholder="https://…" value={urlVal} onChange={e => setUrlVal(e.target.value)} />
          {urlType === 'SLIDES_URL' && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-txt-secondary">Slide Duration (seconds)</label>
              <input type="number" min={1} max={300} className="input" value={slideDuration} onChange={e => setSlideDuration(Number(e.target.value))} />
              <p className="text-xs text-txt-muted">Paste the normal share link — auto-converted to embed URL.</p>
            </div>
          )}
          {urlType === 'CANVA_URL'  && <p className="text-xs text-txt-muted">In Canva: Share → See all → Embed → Smart Embed Link.</p>}
          <div className="flex gap-2">
            <button onClick={() => addUrl.mutate()} disabled={!urlName||!urlVal||addUrl.isPending} className="btn-primary">{addUrl.isPending ? 'Adding…' : 'Add'}</button>
            <button onClick={() => setShowUrl(false)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {/* Content grid/list */}
      <div className="space-y-1.5">
        {items.map(item => {
          const thumb = thumbUrl(item)
          return (
            <div key={item.id} className="card flex items-center gap-3">
              {/* Thumbnail or icon */}
              <div
                className="w-16 h-10 flex-shrink-0 rounded-md overflow-hidden bg-border/50 flex items-center justify-center cursor-pointer relative group"
                onClick={() => previewUrl(item) && setPreviewing(item)}
              >
                {thumb ? (
                  <>
                    <img src={thumb} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-base/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-[10px]">Preview</span>
                    </div>
                  </>
                ) : (
                  <span className="text-xl">{TYPE_ICON[item.type] ?? '📄'}</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium flex items-center gap-2">
                  <span className="truncate">{item.name}</span>
                  {item.validUntil && new Date(item.validUntil) < new Date() && (
                    <span className="text-[10px] bg-coral/10 text-coral px-1.5 py-0.5 rounded font-medium flex-shrink-0">Expired</span>
                  )}
                  {item.validFrom && new Date(item.validFrom) > new Date() && (
                    <span className="text-[10px] bg-yellow/10 text-yellow px-1.5 py-0.5 rounded font-medium flex-shrink-0">Scheduled</span>
                  )}
                </p>
                <p className="text-xs text-txt-muted font-mono truncate">
                  {item.type}
                  {item.fileSize ? ` · ${formatBytes(item.fileSize)}` : ''}
                  {(item.type === 'SLIDES_URL' || item.type === 'PDF') && item.slideDuration ? ` · ${item.slideDuration}s slide delay` : ''}
                  {item.url ? ` · ${item.url.slice(0, 40)}…` : ''}
                  {item.validFrom && ` · From: ${new Date(item.validFrom).toLocaleDateString()}`}
                  {item.validUntil && ` · Until: ${new Date(item.validUntil).toLocaleDateString()}`}
                </p>
              </div>



              {/* Image scale toggle */}
              {item.type === 'IMAGE' && (
                <button onClick={() => {
                  const nextScale = item.scale === 'FIT' ? 'FILL' : item.scale === 'FILL' ? 'STRETCH' : 'FIT';
                  update.mutate({ id: item.id, data: { scale: nextScale } });
                }}
                  title="Click to cycle: Fit (Contain) → Fill (Cover) → Stretch (Distort)"
                  className="text-txt-muted hover:text-teal text-xs transition-colors flex-shrink-0 px-1 font-medium">
                  Scale: {item.scale ?? 'FIT'}
                </button>
              )}

              {/* Mute toggle for videos */}
              {item.type === 'VIDEO' && (
                <button onClick={() => update.mutate({ id: item.id, data: { muted: item.muted !== false } })}
                  title={item.muted !== false ? 'Muted' : 'Audio enabled'}
                  className="flex items-center gap-2 flex-shrink-0 group">
                  <span className="text-xs text-txt-muted group-hover:text-txt-secondary transition-colors hidden sm:inline">Mute Audio</span>
                  <div className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${item.muted !== false ? 'bg-teal' : 'bg-border'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${item.muted !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              )}

              {/* Preview */}
              {(URL_TYPES.includes(item.type) || item.type === 'IMAGE' || item.type === 'PDF') && (
                <button onClick={() => setPreviewing(item)} className="text-txt-muted hover:text-teal text-xs transition-colors flex-shrink-0 px-1">Preview</button>
              )}

              {/* Sync for Google Slides */}
              {item.type === 'SLIDES_URL' && (
                <button onClick={() => syncSlides.mutate(item.id)} disabled={syncSlides.isPending} className="text-txt-muted hover:text-teal text-xs transition-colors flex-shrink-0 px-1">
                  {syncSlides.isPending ? 'Syncing…' : 'Sync'}
                </button>
              )}

              {/* Edit content */}
              <button onClick={() => setEditing(item)} className="text-txt-muted hover:text-teal text-xs transition-colors flex-shrink-0 px-1">Edit</button>

              {/* Delete */}
              <button onClick={() => {
                if (confirm(`Remove "${item.name}"?\nAlso removes it from any playlists.`)) del.mutate(item.id)
              }} className="text-txt-muted hover:text-coral text-xs transition-colors flex-shrink-0 px-1">🗑</button>
            </div>
          )
        })}
        {items.length === 0 && (
          <div className="card py-12 text-center text-txt-secondary text-sm">
            No content yet — drag files here or click upload above.
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal item={editing} saving={update.isPending}
          onSave={data => update.mutate({ id: editing.id, data })}
          onClose={() => setEditing(null)} />
      )}

      {/* Preview modal */}
      {previewing && (
        <PreviewModal item={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  )
}

function toLocalDatetimeString(isoString?: string | null) {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - (offset * 60 * 1000))
  return localDate.toISOString().slice(0, 16)
}

function toUtcIsoString(localString: string) {
  if (!localString) return null
  const date = new Date(localString)
  if (isNaN(date.getTime())) return null
  return date.toISOString()
}

function EditModal({ item, saving, onSave, onClose }: { item: Content; saving: boolean; onSave: (d: any) => void; onClose: () => void }) {
  const [name, setName] = useState(item.name)
  const [url,  setUrl]  = useState(item.url ?? '')
  const [slideDuration, setSlideDuration] = useState(item.slideDuration || 5)
  const [validFrom, setValidFrom] = useState(toLocalDatetimeString(item.validFrom))
  const [validUntil, setValidUntil] = useState(toLocalDatetimeString(item.validUntil))

  const handleSave = () => {
    onSave({
      name,
      url: URL_TYPES.includes(item.type) ? url : undefined,
      slideDuration: (item.type === 'SLIDES_URL' || item.type === 'PDF') ? slideDuration : undefined,
      validFrom: toUtcIsoString(validFrom),
      validUntil: toUtcIsoString(validUntil),
    })
  }

  const isUrlInvalid = URL_TYPES.includes(item.type) && !url
  const isSaveDisabled = !name || isUrlInvalid || saving

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">Edit {TYPE_ICON[item.type]} content</h2>
          <button onClick={onClose} className="text-txt-muted hover:text-txt-primary text-lg">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Display name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          {URL_TYPES.includes(item.type) && (
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">URL</label>
              <input className="input font-mono text-xs" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {item.type === 'SLIDES_URL' && <p className="text-xs text-txt-muted -mt-2">Paste a normal share link — auto-converted to embed URL.</p>}
          
          {(item.type === 'SLIDES_URL' || item.type === 'PDF') && (
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">Slide Duration (seconds)</label>
              <input type="number" min={1} max={300} className="input" value={slideDuration} onChange={e => setSlideDuration(Number(e.target.value))} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">Valid From (optional)</label>
              <input type="datetime-local" className="input text-xs" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">Valid Until (optional)</label>
              <input type="datetime-local" className="input text-xs" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={isSaveDisabled} className="btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewModal({ item, onClose }: { item: Content; onClose: () => void }) {
  const url = previewUrl(item)
  if (!url) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/90 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="max-w-5xl w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="font-medium">{item.name}</p>
          <button onClick={onClose} className="btn-ghost text-sm">✕ Close</button>
        </div>
        {item.type === 'IMAGE' ? (
          <img src={url} alt={item.name} className="w-full max-h-[80vh] object-contain rounded-xl border border-border" />
        ) : (
          <div className="w-full aspect-video rounded-xl border border-border overflow-hidden bg-base">
            <iframe src={url} className="w-full h-full" allowFullScreen title={item.name} />
          </div>
        )}
      </div>
    </div>
  )
}
