import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuth } from '../lib/store'

interface User {
  id: string; name: string; email: string; role: string; createdAt: string
  team?: { id: string; name: string }
}

const ROLES = ['VIEWER', 'CONTENT_CREATOR', 'TEAM_ADMIN', 'SUPER_ADMIN'] as const
type Role = typeof ROLES[number]

const ROLE_LABEL: Record<Role, string> = {
  VIEWER:           'Viewer',
  CONTENT_CREATOR:  'Content Creator',
  TEAM_ADMIN:       'Team Admin',
  SUPER_ADMIN:      'Super Admin',
}

const ROLE_COLOR: Record<Role, string> = {
  VIEWER:           'text-txt-secondary bg-border border-border',
  CONTENT_CREATOR:  'text-teal bg-teal-glow border-teal/30',
  TEAM_ADMIN:       'text-amber bg-amber-glow border-amber/30',
  SUPER_ADMIN:      'text-coral bg-coral-glow border-coral/30',
}

// ── Role grants matrix ────────────────────────────────────────────────────────

const GRANTS: { label: string; roles: Role[] }[] = [
  { label: 'View dashboard & device status',       roles: ['VIEWER','CONTENT_CREATOR','TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Upload content & add URLs',             roles: ['CONTENT_CREATOR','TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Create & edit playlists',               roles: ['CONTENT_CREATOR','TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Deploy playlists to devices',           roles: ['TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Delete content & playlists',            roles: ['TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Add & remove devices',                  roles: ['TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Remote control (restart/reboot/logs)',  roles: ['TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Create & manage schedules',             roles: ['TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Manage team members',                   roles: ['TEAM_ADMIN','SUPER_ADMIN'] },
  { label: 'Access all teams',                      roles: ['SUPER_ADMIN'] },
  { label: 'Create Super Admin accounts',           roles: ['SUPER_ADMIN'] },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function Users() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const [showAdd, setShowAdd] = useState(false)
  const [showGrants, setShowGrants] = useState(false)

  // New user form state
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [role,     setRole]     = useState<Role>('VIEWER')

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data),
  })

  // Fetch organizations for moving users (Super Admin only)
  const { data: orgs = [] } = useQuery<any[]>({
    queryKey: ['orgs'],
    queryFn:  () => api.get('/team').then(r => r.data),
    enabled: me?.role === 'SUPER_ADMIN',
  })

  const create = useMutation({
    mutationFn: () => api.post('/users', { name, email, password, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowAdd(false); setName(''); setEmail(''); setPassword(''); setRole('VIEWER')
      toast.success('User created')
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to create user'),
  })

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api.patch(`/users/${id}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Role updated') },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to update role'),
  })

  const moveUser = useMutation({
    mutationFn: ({ id, teamId }: { id: string; teamId: string | null }) =>
      api.patch(`/users/${id}`, { teamId }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('User organization updated')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Failed to move user')
    }
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User removed') },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to remove user'),
  })

  const canManage = me?.role === 'SUPER_ADMIN' || me?.role === 'TEAM_ADMIN'

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-txt-secondary text-sm mt-0.5">Manage team members and access levels</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowGrants(!showGrants)} className="btn-ghost">
            {showGrants ? 'Hide' : 'Role'} permissions
          </button>
          {canManage && (
            <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">+ Add user</button>
          )}
        </div>
      </div>

      {/* Role grants table */}
      {showGrants && (
        <div className="card p-0 overflow-x-auto">
          <div className="p-4 border-b border-border">
            <p className="font-medium text-sm">Role permissions</p>
            <p className="text-xs text-txt-muted mt-0.5">What each role can do</p>
          </div>
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-3 text-xs text-txt-muted font-medium">Capability</th>
                {ROLES.map(r => (
                  <th key={r} className="px-3 py-3 text-center">
                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ROLE_COLOR[r]}`}>
                      {ROLE_LABEL[r].replace(' ', '\u00A0')}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GRANTS.map((g, i) => (
                <tr key={g.label} className={`border-b border-border/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-surface/40'}`}>
                  <td className="px-4 py-2.5 text-xs text-txt-secondary">{g.label}</td>
                  {ROLES.map(r => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      {g.roles.includes(r)
                        ? <span className="text-teal text-base leading-none">✓</span>
                        : <span className="text-border text-base leading-none">—</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add user form */}
      {showAdd && (
        <div className="card max-w-md space-y-3">
          <p className="font-medium text-sm">New user</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-txt-secondary mb-1">Name</label>
              <input className="input" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} autoFocus />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-txt-secondary mb-1">Email</label>
              <input className="input" type="email" placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-txt-secondary mb-1">Password</label>
              <input className="input" type="password" placeholder="Min 8 chars" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-txt-secondary mb-1">Role</label>
              <select className="input" value={role} onChange={e => setRole(e.target.value as Role)}>
                {ROLES.filter(r => me?.role === 'SUPER_ADMIN' || r !== 'SUPER_ADMIN').map(r => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => create.mutate()}
              disabled={!name || !email || !password || create.isPending}
              className="btn-primary">
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {/* User list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="card h-16 animate-pulse" />)}
        </div>
      ) : users.length === 0 ? (
        <div className="card py-12 text-center text-txt-secondary text-sm">
          No users yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {users.map(u => (
            <div key={u.id} className="card flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Avatar + info */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-full bg-border flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-txt-secondary">
                    {u.name?.[0]?.toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{u.name}</p>
                    {u.id === me?.id && (
                      <span className="text-[10px] text-txt-muted border border-border px-1.5 py-0.5 rounded-full">you</span>
                    )}
                  </div>
                  <p className="text-xs text-txt-muted truncate">{u.email}</p>
                  {me?.role === 'SUPER_ADMIN' ? (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] text-txt-muted font-mono">org:</span>
                      <select
                        value={u.team?.id || ''}
                        onChange={(e) => {
                          if (confirm(`Are you sure you want to move ${u.name} to another organization? This will clear all their screen access restrictions.`)) {
                            moveUser.mutate({ id: u.id, teamId: e.target.value || null })
                          }
                        }}
                        className="bg-card border border-border text-txt-secondary rounded px-1.5 py-0.5 text-[9px] font-mono focus:outline-none focus:border-teal transition-colors cursor-pointer"
                      >
                        <option value="">No Organization</option>
                        {orgs.map((org: any) => (
                          <option key={org.id} value={org.id}>
                            {org.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : u.team && (
                    <p className="text-[10px] text-txt-muted">{u.team.name}</p>
                  )}
                </div>
              </div>

              {/* Role selector + remove */}
              <div className="flex items-center gap-2 flex-shrink-0 sm:ml-auto">
                {canManage && u.id !== me?.id ? (
                  <select
                    value={u.role}
                    onChange={e => changeRole.mutate({ id: u.id, role: e.target.value as Role })}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border bg-transparent cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal/50 ${ROLE_COLOR[u.role as Role]}`}
                  >
                    {ROLES.filter(r => me?.role === 'SUPER_ADMIN' || r !== 'SUPER_ADMIN').map(r => (
                      <option key={r} value={r} className="bg-surface text-txt-primary">{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${ROLE_COLOR[u.role as Role]}`}>
                    {ROLE_LABEL[u.role as Role]}
                  </span>
                )}

                {canManage && u.id !== me?.id && (
                  <button
                    onClick={() => { if (confirm(`Remove ${u.name}?`)) remove.mutate(u.id) }}
                    className="text-txt-muted hover:text-coral transition-colors text-xs px-2">
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
