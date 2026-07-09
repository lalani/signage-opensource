import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import api from '../lib/api'
import PlaylistBuilder from '../components/PlaylistBuilder'

interface Playlist {
  id:string; name:string; updatedAt:string
  creator?:{name:string}
  _count:{items:number; devices:number}
}
interface PlaylistDetail extends Playlist {
  items: { id:string; contentId:string; durationSec:number; orderIndex:number; content:{id:string;name:string;type:string}; crossfade:boolean }[]
}

export default function Playlists() {
  const qc = useQueryClient()
  const [editing, setEditing]   = useState<PlaylistDetail | null>(null)
  const [newName, setNewName]   = useState('')
  const [showAdd, setShowAdd]   = useState(false)
  const [deployingId, setDeployingId] = useState<string | null>(null)

  const { data: playlists = [] } = useQuery<Playlist[]>({
    queryKey: ['playlists'],
    queryFn:  () => api.get('/playlists').then(r => r.data),
  })

  const { data: devices = [] } = useQuery<any[]>({
    queryKey: ['devices'],
    queryFn:  () => api.get('/devices').then(r => r.data),
    enabled:  !!deployingId
  })

  const create = useMutation({
    mutationFn: () => api.post('/playlists', { name: newName }).then(r => r.data),
    onSuccess: (pl) => {
      qc.invalidateQueries({queryKey:['playlists']})
      setNewName(''); setShowAdd(false)
      // Open the builder immediately
      openBuilder(pl.id)
    },
  })

  const del = useMutation({
    mutationFn: (id:string) => api.delete(`/playlists/${id}`),
    onSuccess: () => { qc.invalidateQueries({queryKey:['playlists']}); toast.success('Deleted') },
  })

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/playlists/${id}/duplicate`).then(r => r.data),
    onSuccess: (pl) => {
      qc.invalidateQueries({queryKey:['playlists']})
      toast.success(`Duplicated → "${pl.name}"`)
    },
  })

  async function openBuilder(id: string) {
    const { data } = await api.get(`/playlists/${id}`)
    setEditing(data)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Playlists</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary">+ New playlist</button>
      </div>

      {showAdd && (
        <div className="card max-w-sm space-y-3">
          <input className="input" placeholder="Playlist name" value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newName && create.mutate()} autoFocus />
          <div className="flex gap-2">
            <button onClick={() => create.mutate()} disabled={!newName||create.isPending} className="btn-primary">Create</button>
            <button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {playlists.map(pl => (
          <div key={pl.id} className="card flex flex-col sm:flex-row sm:items-center gap-3 hover:border-border/80 transition-colors">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{pl.name}</p>
              <p className="text-xs text-txt-muted mt-0.5">
                {pl._count.items} items · {pl._count.devices} device(s)
                {pl.creator ? ` · by ${pl.creator.name}` : ''}
                {' · '}updated {formatDistanceToNow(new Date(pl.updatedAt), {addSuffix:true})}
              </p>
            </div>
            <div className="flex gap-1.5 flex-wrap sm:flex-shrink-0">
              <button onClick={() => setDeployingId(pl.id)} className="btn-ghost text-xs text-teal font-medium border border-teal/15 hover:bg-teal-glow">🚀 Deploy</button>
              <button onClick={() => openBuilder(pl.id)} className="btn-primary text-xs">Edit</button>
              <button onClick={() => duplicate.mutate(pl.id)} disabled={duplicate.isPending}
                className="btn-ghost text-xs" title="Duplicate playlist">⧉ Copy</button>
              <button onClick={() => { if(confirm('Delete playlist?')) del.mutate(pl.id) }}
                className="btn-ghost text-xs text-txt-muted hover:text-coral">Delete</button>
            </div>
          </div>
        ))}
        {playlists.length === 0 && (
          <div className="card py-12 text-center text-txt-secondary text-sm">
            No playlists yet — create one to get started.
          </div>
        )}
      </div>

      {editing && <PlaylistBuilder playlist={editing} onClose={() => { setEditing(null); qc.invalidateQueries({queryKey:['playlists']}) }} />}

      {deployingId && (
        <DeployModal
          playlistId={deployingId}
          devices={devices}
          onClose={() => setDeployingId(null)}
          onDeployed={() => {
            setDeployingId(null)
            qc.invalidateQueries({ queryKey: ['playlists'] })
          }}
        />
      )}
    </div>
  )
}

function DeployModal({ playlistId, devices, onClose, onDeployed }: {
  playlistId: string
  devices: any[]
  onClose: () => void
  onDeployed: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])

  const deploy = useMutation({
    mutationFn: () => api.post(`/playlists/${playlistId}/deploy`, { deviceIds: selected }),
    onSuccess: (r) => {
      toast.success(`Deployed to ${r.data.deployed} screen(s)`)
      onDeployed()
    },
    onError: () => {
      toast.error('Deployment failed')
    }
  })

  const toggleSelect = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const selectAll = () => setSelected(devices.map(d => d.id))
  const selectNone = () => setSelected([])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-sm text-txt-primary">Deploy Playlist</h2>
          <button onClick={onClose} className="text-txt-muted hover:text-txt-primary transition-colors text-lg leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex justify-between items-center text-xs">
            <span className="text-txt-secondary font-medium">Select Screens to deploy to:</span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-teal hover:underline font-medium">Select All</button>
              <span className="text-border">|</span>
              <button onClick={selectNone} className="text-txt-muted hover:text-txt-primary font-medium">Clear All</button>
            </div>
          </div>

          <div className="space-y-2 border border-border/50 rounded-xl p-3 bg-base/35 overflow-y-auto max-h-[220px]">
            {devices.map((d: any) => (
              <label key={d.id} className="flex items-center gap-3 text-xs text-txt-secondary hover:text-txt-primary cursor-pointer py-1.5 border-b border-border/20 last:border-b-0">
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  onChange={() => toggleSelect(d.id)}
                  className="rounded border-border text-teal focus:ring-teal bg-card w-4 h-4"
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-txt-primary truncate">{d.name}</span>
                  <span className="text-[10px] text-txt-muted truncate">{d.location || 'No location set'}</span>
                </div>
              </label>
            ))}
            {devices.length === 0 && (
              <p className="text-xs text-txt-muted italic py-6 text-center">No screens registered.</p>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-between">
          <span className="text-xs text-txt-muted">
            {selected.length} screen{selected.length !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            <button 
              onClick={() => deploy.mutate()} 
              disabled={selected.length === 0 || deploy.isPending} 
              className="btn-primary text-xs"
            >
              {deploy.isPending ? 'Deploying...' : 'Deploy Playlist'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
