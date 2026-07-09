import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../lib/api'
import GridSimulator from '../components/GridSimulator'

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

interface Device {
  id: string
  name: string
  location?: string
  online: boolean
  gridId: string | null
}

export default function Grids() {
  const qc = useQueryClient()
  const [selectedGrid, setSelectedGrid] = useState<DeviceGrid | null>(null)
  
  // Create state variables for new grid
  const [showCreate, setShowCreate] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRows, setNewRows] = useState(2)
  const [newCols, setNewCols] = useState(2)

  // Track assignments in active editor
  const [assignments, setAssignments] = useState<Record<string, string>>({}) // "row,col" -> deviceId

  // Query playlists for simulator dropdown
  const { data: playlists = [] } = useQuery<any[]>({
    queryKey: ['playlists'],
    queryFn: () => api.get('/playlists').then(r => r.data)
  })

  // Queries
  const { data: grids = [], isLoading: gridsLoading } = useQuery<DeviceGrid[]>({
    queryKey: ['grids'],
    queryFn: () => api.get('/grids').then(r => r.data)
  })

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices').then(r => r.data)
  })

  // Mutations
  const createGrid = useMutation({
    mutationFn: (data: { name: string; rows: number; cols: number }) =>
      api.post('/grids', data).then(r => r.data),
    onSuccess: (grid) => {
      qc.invalidateQueries({ queryKey: ['grids'] })
      setShowCreate(false)
      setNewName('')
      setNewRows(2)
      setNewCols(2)
      setSelectedGrid(grid)
      initAssignments(grid)
      toast.success('Grid created successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to create grid')
    }
  })

  const updateGrid = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.patch(`/grids/${id}`, data).then(r => r.data),
    onSuccess: (grid) => {
      qc.invalidateQueries({ queryKey: ['grids'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      setSelectedGrid(grid)
      initAssignments(grid)
      toast.success('Grid saved successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to save grid')
    }
  })

  const deleteGrid = useMutation({
    mutationFn: (id: string) => api.delete(`/grids/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grids'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      setSelectedGrid(null)
      setAssignments({})
      toast.success('Grid deleted successfully')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to delete grid')
    }
  })

  const initAssignments = (grid: DeviceGrid) => {
    const initial: Record<string, string> = {}
    grid.devices.forEach(d => {
      if (d.gridRow !== null && d.gridCol !== null) {
        initial[`${d.gridRow},${d.gridCol}`] = d.id
      }
    })
    setAssignments(initial)
  }

  const handleSelectGrid = (grid: DeviceGrid) => {
    setSelectedGrid(grid)
    initAssignments(grid)
  }

  const handleSave = () => {
    if (!selectedGrid) return

    const deviceAssignments = Object.entries(assignments)
      .filter(([_, devId]) => !!devId)
      .map(([coords, devId]) => {
        const [row, col] = coords.split(',').map(Number)
        return { deviceId: devId, row, col }
      })

    updateGrid.mutate({
      id: selectedGrid.id,
      data: { deviceAssignments }
    })
  }

  // Get list of devices that are either not assigned to any grid OR assigned to the current grid
  const getAvailableDevices = (currentRow: number, currentCol: number) => {
    const currentAssignedId = assignments[`${currentRow},${currentCol}`]
    const allAssignedIds = Object.values(assignments)

    return devices.filter(d => {
      if (d.id === currentAssignedId) return true // Keep current device in list
      if (d.gridId && d.gridId !== selectedGrid?.id) return false // Assigned to another grid in DB
      if (allAssignedIds.includes(d.id)) return false // Assigned to another cell in current layout
      return true
    })
  }

  const handleCellSelect = (row: number, col: number, deviceId: string) => {
    setAssignments(prev => ({
      ...prev,
      [`${row},${col}`]: deviceId
    }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-txt-primary">Grids</h1>
          <p className="text-txt-secondary text-sm mt-0.5">Configure screen matrices and video walls</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">+ Create Grid</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Grid List */}
        <div className="lg:col-span-1 space-y-3">
          <div className="card space-y-4">
            <h2 className="font-semibold text-sm text-txt-primary">Video Walls</h2>
            
            {gridsLoading ? (
              <p className="text-xs text-txt-muted">Loading grids...</p>
            ) : grids.length === 0 ? (
              <p className="text-xs text-txt-muted italic">No screen grids configured yet.</p>
            ) : (
              <div className="space-y-2">
                {grids.map(g => (
                  <button
                    key={g.id}
                    onClick={() => handleSelectGrid(g)}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 ${
                      selectedGrid?.id === g.id
                        ? 'border-teal bg-teal-glow/10 text-teal'
                        : 'border-border bg-surface/50 text-txt-secondary hover:text-txt-primary hover:border-border/80'
                    }`}
                  >
                    <span className="font-medium text-xs text-txt-primary">{g.name}</span>
                    <span className="text-[10px] font-mono">
                      📐 {g.rows} × {g.cols} matrix · {g.devices.length} screens
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Visual Layout & Mapping */}
        <div className="lg:col-span-3">
          {selectedGrid ? (
            <div className="card space-y-6">
              <div className="flex justify-between items-center pb-4 border-b border-border/40">
                <div>
                  <h2 className="font-semibold text-md text-txt-primary">{selectedGrid.name}</h2>
                  <p className="text-txt-secondary text-xs mt-1">
                    Dimensions: {selectedGrid.rows} rows × {selectedGrid.cols} columns
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowPreview(true)} className="btn-ghost text-xs border border-border/20 px-3">
                    👁️ Preview Grid
                  </button>
                  <button onClick={handleSave} disabled={updateGrid.isPending} className="btn-primary text-xs px-3">
                    Save Layout
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Delete this screen grid? Assigned screens will be reset back to normal standalone mode.')) {
                        deleteGrid.mutate(selectedGrid.id)
                      }
                    }}
                    disabled={deleteGrid.isPending}
                    className="btn-ghost text-xs text-coral hover:bg-coral-glow/10 border border-coral/20 px-3"
                  >
                    Delete Grid
                  </button>
                </div>
              </div>

              {/* Visual Grid Arrangement */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase font-bold tracking-wider text-txt-secondary">
                  Visual Layout Arranger
                </label>
                
                <div
                  className="grid gap-4 p-4 border border-border rounded-xl bg-surface/30 overflow-auto"
                  style={{
                    gridTemplateRows: `repeat(${selectedGrid.rows}, minmax(110px, 1fr))`,
                    gridTemplateColumns: `repeat(${selectedGrid.cols}, minmax(180px, 1fr))`
                  }}
                >
                  {Array.from({ length: selectedGrid.rows }).map((_, r) =>
                    Array.from({ length: selectedGrid.cols }).map((_, c) => {
                      const currentDevId = assignments[`${r},${c}`] || ''
                      const available = getAvailableDevices(r, c)
                      const targetDevice = devices.find(d => d.id === currentDevId)

                      return (
                        <div
                          key={`${r}-${c}`}
                          className={`p-4 border rounded-xl flex flex-col justify-between gap-3 h-full min-h-[120px] transition-colors ${
                            currentDevId
                              ? 'border-border bg-card'
                              : 'border-dashed border-border/60 bg-surface/20'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <span className="text-[10px] font-mono text-txt-muted font-bold">
                              R{r + 1} C{c + 1}
                            </span>
                            {targetDevice && (
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                targetDevice.online ? 'bg-teal animate-pulse' : 'bg-coral'
                              }`} />
                            )}
                          </div>
                          
                          <select
                            value={currentDevId}
                            onChange={(e) => handleCellSelect(r, c, e.target.value)}
                            className="bg-surface border border-border text-txt-primary text-xs rounded-lg px-2 py-1.5 w-full focus:outline-none focus:border-teal transition-colors cursor-pointer"
                          >
                            <option value="">Unassigned</option>
                            {available.map(d => (
                              <option key={d.id} value={d.id}>
                                {d.name} {d.online ? '(Online)' : '(Offline)'}
                              </option>
                            ))}
                          </select>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="card h-64 flex items-center justify-center border-dashed border-border text-txt-secondary text-sm italic">
              Select or create a grid to start configuring your video wall matrix.
            </div>
          )}
        </div>
      </div>

      {/* Create Modal Dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-base/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card max-w-sm w-full space-y-4 bg-surface border border-border shadow-2xl">
            <div>
              <h3 className="font-semibold text-sm text-txt-primary">Create Screen Grid</h3>
              <p className="text-txt-secondary text-xs mt-0.5">Specify grid sizing for the array</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] text-txt-secondary uppercase tracking-wider font-semibold">Grid Name</label>
                <input
                  type="text"
                  placeholder="e.g. Front Window Matrix"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="input"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-txt-secondary uppercase tracking-wider font-semibold">Rows (Horizontal)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newRows}
                    onChange={e => setNewRows(Number(e.target.value))}
                    className="input font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-txt-secondary uppercase tracking-wider font-semibold">Columns (Vertical)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newCols}
                    onChange={e => setNewCols(Number(e.target.value))}
                    className="input font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-border/40">
              <button
                onClick={() => createGrid.mutate({ name: newName, rows: newRows, cols: newCols })}
                disabled={!newName.trim() || createGrid.isPending}
                className="btn-primary flex-1"
              >
                Create Grid
              </button>
              <button
                onClick={() => {
                  setShowCreate(false)
                  setNewName('')
                  setNewRows(2)
                  setNewCols(2)
                }}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreview && selectedGrid && (
        <GridSimulator
          grid={selectedGrid}
          playlists={playlists}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
