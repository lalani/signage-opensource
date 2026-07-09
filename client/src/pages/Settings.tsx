import { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuth } from '../lib/store'
import { formatBytes } from '../lib/utils'

export default function Settings() {
  const { user, setUser, activeTeamId } = useAuth()
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingSplash, setUploadingSplash] = useState(false)
  const [orgs, setOrgs] = useState<any[]>([])
  const [newOrgName, setNewOrgName] = useState('')
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [editingQuota, setEditingQuota] = useState<Record<string, string>>({})
  const [editingDevices, setEditingDevices] = useState<Record<string, string>>({})
  const [editingIngress, setEditingIngress] = useState<Record<string, string>>({})
  const [editingEgress, setEditingEgress] = useState<Record<string, string>>({})

  const logoInputRef = useRef<HTMLInputElement>(null)
  const splashInputRef = useRef<HTMLInputElement>(null)

  const fetchOrgs = async () => {
    try {
      const { data } = await api.get('/team')
      setOrgs(data)
      setEditingQuota({})
      setEditingDevices({})
      setEditingIngress({})
      setEditingEgress({})
    } catch (err) {
      console.error('Failed to fetch organizations:', err)
    }
  }

  const handleUpdateQuota = async (orgId: string, limitGb: number) => {
    if (isNaN(limitGb) || limitGb <= 0) {
      toast.error('Invalid quota limit. Must be a positive number.')
      return
    }

    const limitBytes = Math.round(limitGb * 1024 * 1024 * 1024)
    try {
      await api.patch(`/team/${orgId}`, { maxStorage: limitBytes })
      toast.success('Organization storage limit updated')
      await fetchOrgs()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update storage limit')
    }
  }

  const handleUpdateDevices = async (orgId: string, limit: number) => {
    if (isNaN(limit) || limit < 1) {
      toast.error('Invalid device limit. Must be at least 1.')
      return
    }

    try {
      await api.patch(`/team/${orgId}`, { maxDevices: limit })
      toast.success('Organization device limit updated')
      await fetchOrgs()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update device limit')
    }
  }

  const handleUpdateIngress = async (orgId: string, limitGb: number) => {
    if (isNaN(limitGb) || limitGb <= 0) {
      toast.error('Invalid ingress limit. Must be a positive number.')
      return
    }

    const limitBytes = Math.round(limitGb * 1024 * 1024 * 1024)
    try {
      await api.patch(`/team/${orgId}`, { maxIngressMonthly: limitBytes })
      toast.success('Organization upload limit updated')
      await fetchOrgs()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update upload limit')
    }
  }

  const handleUpdateEgress = async (orgId: string, limitGb: number) => {
    if (isNaN(limitGb) || limitGb <= 0) {
      toast.error('Invalid egress limit. Must be a positive number.')
      return
    }

    const limitBytes = Math.round(limitGb * 1024 * 1024 * 1024)
    try {
      await api.patch(`/team/${orgId}`, { maxEgressMonthly: limitBytes })
      toast.success('Organization download limit updated')
      await fetchOrgs()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update download limit')
    }
  }

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      fetchOrgs()
    }
  }, [user])

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newOrgName.trim()) return

    setCreatingOrg(true)
    try {
      await api.post('/team', { name: newOrgName.trim() })
      toast.success('Organization created successfully')
      setNewOrgName('')
      await fetchOrgs()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create organization')
    } finally {
      setCreatingOrg(false)
    }
  }

  const handleTogglePremium = async (orgId: string, currentVal: boolean) => {
    try {
      await api.patch(`/team/${orgId}`, { isPremium: !currentVal })
      toast.success('Organization tier updated')
      await fetchOrgs()
      await refreshUser()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update organization tier')
    }
  }

  const refreshUser = async () => {
    try {
      const { data } = await api.get('/auth/me')
      setUser(data)
    } catch (err) {
      console.error('Failed to refresh user branding details:', err)
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || !files[0]) return
    const file = files[0]

    // Verify format
    const allowed = ['image/png', 'image/jpeg', 'image/jpg']
    if (!allowed.includes(file.type)) {
      toast.error('Only PNG and JPEG formats are supported for the logo')
      return
    }

    setUploadingLogo(true)
    const fd = new FormData()
    fd.append('logo', file)

    try {
      await api.post('/team/settings', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success('Team logo updated successfully')
      await refreshUser()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to upload logo')
    } finally {
      setUploadingLogo(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  async function handleSplashUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || !files[0]) return
    const file = files[0]

    // Verify format
    const allowed = ['image/png', 'image/jpeg', 'image/jpg']
    if (!allowed.includes(file.type)) {
      toast.error('Only PNG and JPEG formats are supported for the splash screen')
      return
    }

    setUploadingSplash(true)
    const fd = new FormData()
    fd.append('splash', file)

    try {
      await api.post('/team/settings', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success('Kiosk splash screen updated successfully')
      await refreshUser()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to upload splash screen')
    } finally {
      setUploadingSplash(false)
      if (splashInputRef.current) splashInputRef.current.value = ''
    }
  }

  async function handleRemove(type: 'logo' | 'splash') {
    if (!confirm(`Are you sure you want to restore the default ${type === 'logo' ? 'logo' : 'splash screen'}?`)) {
      return
    }

    try {
      await api.delete(`/team/settings/${type}`)
      toast.success(`Restored default ${type === 'logo' ? 'logo' : 'splash screen'}`)
      await refreshUser()
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? `Failed to remove ${type}`)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-txt-primary">Settings</h1>
        <p className="text-txt-secondary text-sm mt-0.5">Customize team logo and kiosk boot splash screen</p>
      </div>

      {user?.role === 'SUPER_ADMIN' && !activeTeamId ? (
        <div className="card border-amber/30 bg-amber-glow/10 text-amber p-5 flex gap-4 items-start">
          <span className="text-xl mt-0.5">⚠️</span>
          <div>
            <p className="font-semibold text-sm">No Organization Selected</p>
            <p className="text-xs text-txt-secondary mt-1">
              Please select a specific organization from the "Active Organization" dropdown in the sidebar to customize its menu logo and boot splash screen.
            </p>
          </div>
        </div>
      ) : (
        <>
          {user?.team && (
            <div className="card space-y-4 mb-6">
              <div>
                <h2 className="text-md font-semibold text-txt-primary">Organization Quotas & Monthly Usage</h2>
                <p className="text-txt-secondary text-xs mt-1">
                  Live storage space and monthly bandwidth consumption for <strong>{user.team.name}</strong>.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Storage Quota */}
                <div className="border border-border/50 rounded-xl p-4 bg-surface/30 space-y-3">
                  <div className="flex justify-between items-baseline text-xs text-txt-secondary">
                    <span>Disk Storage Space</span>
                    <span className="font-semibold text-txt-primary">
                      {formatBytes(user.team.storageUsed || 0)} / {formatBytes(user.team.maxStorage || 0)}
                    </span>
                  </div>
                  <div className="w-full bg-base rounded-full h-2 overflow-hidden border border-border/30">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        (user.team.storageUsed || 0) / (user.team.maxStorage || 1) > 0.9 ? 'bg-coral' : 'bg-teal'
                      }`}
                      style={{ width: `${Math.min(100, ((user.team.storageUsed || 0) / (user.team.maxStorage || 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-txt-muted">Used for content, video assets, and PDF files.</p>
                </div>

                {/* Ingress Quota */}
                <div className="border border-border/50 rounded-xl p-4 bg-surface/30 space-y-3">
                  <div className="flex justify-between items-baseline text-xs text-txt-secondary">
                    <span>Upload Bandwidth (Ingress)</span>
                    <span className="font-semibold text-txt-primary">
                      {formatBytes(user.team.currentIngressMonthly || 0)} / {formatBytes(user.team.maxIngressMonthly || 0)}
                    </span>
                  </div>
                  <div className="w-full bg-base rounded-full h-2 overflow-hidden border border-border/30">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        (user.team.currentIngressMonthly || 0) / (user.team.maxIngressMonthly || 1) > 0.9 ? 'bg-coral' : 'bg-teal'
                      }`}
                      style={{ width: `${Math.min(100, ((user.team.currentIngressMonthly || 0) / (user.team.maxIngressMonthly || 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-txt-muted">
                    Resets on {user.team.billingCycleAnchor ? new Date(user.team.billingCycleAnchor).toLocaleDateString() : 'monthly anchor'}
                  </p>
                </div>

                {/* Egress Quota */}
                <div className="border border-border/50 rounded-xl p-4 bg-surface/30 space-y-3">
                  <div className="flex justify-between items-baseline text-xs text-txt-secondary">
                    <span>Download Bandwidth (Egress)</span>
                    <span className="font-semibold text-txt-primary">
                      {formatBytes(user.team.currentEgressMonthly || 0)} / {formatBytes(user.team.maxEgressMonthly || 0)}
                    </span>
                  </div>
                  <div className="w-full bg-base rounded-full h-2 overflow-hidden border border-border/30">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        (user.team.currentEgressMonthly || 0) / (user.team.maxEgressMonthly || 1) > 0.9 ? 'bg-coral' : 'bg-teal'
                      }`}
                      style={{ width: `${Math.min(100, ((user.team.currentEgressMonthly || 0) / (user.team.maxEgressMonthly || 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-txt-muted">
                    Device screens count: <strong>{user.team.devicesCount || 0}</strong> / {user.team.maxDevices || 1}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Logo Customization Card */}
            <div className="card flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div>
                  <h2 className="text-md font-semibold text-txt-primary">Menu Logo</h2>
                  <p className="text-txt-secondary text-xs mt-1">
                    This logo is displayed at the top of the navigation menu sidebar on desktop and in the header on mobile.
                  </p>
                </div>

                {/* Preview Section */}
                <div className="flex items-center justify-center p-6 bg-surface border border-border rounded-xl h-48">
                  {user?.team?.logoPath ? (
                    <div className="relative group flex items-center justify-center w-32 h-32 bg-base/50 rounded-xl p-2 border border-border/50">
                      <img
                        src={`/media/${user.team.logoPath}?t=${Date.now()}`}
                        alt="Current Logo"
                        className="max-w-full max-h-full object-contain"
                      />
                      <div className="absolute inset-0 bg-base/80 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleRemove('logo')}
                          className="px-3 py-1.5 bg-coral text-base text-xs font-semibold rounded-lg hover:bg-coral-dim transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-16 h-16 rounded-2xl bg-teal-glow border border-teal/20 flex items-center justify-center">
                        <span className="text-teal text-2xl font-bold font-mono">S</span>
                      </div>
                      <span className="text-txt-muted text-xs font-medium">Default Branding Active</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="text-[11px] text-txt-secondary space-y-1 bg-surface/50 border border-border/30 rounded-lg p-3">
                  <p className="font-semibold text-txt-primary">Guidelines:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Recommended aspect ratio: 1:1 square</li>
                    <li>Recommended size: 120 x 120 pixels</li>
                    <li>Supported formats: PNG, JPG, JPEG</li>
                  </ul>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    ref={logoInputRef}
                    onChange={handleLogoUpload}
                    accept="image/png, image/jpeg, image/jpg"
                    className="hidden"
                  />
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    {uploadingLogo ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-base" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <span>Upload Logo</span>
                    )}
                  </button>
                  {user?.team?.logoPath && (
                    <button
                      onClick={() => handleRemove('logo')}
                      className="btn-ghost border border-border"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Kiosk Boot Splash Screen Customization Card */}
            <div className="card flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div>
                  <h2 className="text-md font-semibold text-txt-primary">Kiosk Boot Splash Screen</h2>
                  <p className="text-txt-secondary text-xs mt-1">
                    This image is displayed by Raspberry Pi media players on startup and during system boot/idle sequences.
                  </p>
                </div>

                {/* Preview Section */}
                <div className="flex items-center justify-center p-4 bg-surface border border-border rounded-xl h-48 overflow-hidden">
                  {user?.team?.splashPath ? (
                    <div className="relative group w-full h-full bg-base/50 rounded-lg overflow-hidden border border-border/50 flex items-center justify-center">
                      <img
                        src={`/media/${user.team.splashPath}?t=${Date.now()}`}
                        alt="Current Kiosk Splash"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-base/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleRemove('splash')}
                          className="px-3 py-1.5 bg-coral text-base text-xs font-semibold rounded-lg hover:bg-coral-dim transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-24 h-14 bg-base border border-border/50 rounded-lg flex flex-col items-center justify-center shadow-lg relative overflow-hidden">
                        <div className="w-6 h-6 rounded-md bg-teal-glow border border-teal/20 flex items-center justify-center scale-90">
                          <span className="text-teal text-[10px] font-bold font-mono">S</span>
                        </div>
                      </div>
                      <span className="text-txt-muted text-xs font-medium">Default Dark Splash Active</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="text-[11px] text-txt-secondary space-y-1 bg-surface/50 border border-border/30 rounded-lg p-3">
                  <p className="font-semibold text-txt-primary">Guidelines:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Recommended aspect ratio: 16:9 landscape</li>
                    <li>Recommended resolution: 1920 x 1080 pixels</li>
                    <li>Supported formats: PNG, JPG, JPEG</li>
                  </ul>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    ref={splashInputRef}
                    onChange={handleSplashUpload}
                    accept="image/png, image/jpeg, image/jpg"
                    className="hidden"
                  />
                  <button
                    onClick={() => splashInputRef.current?.click()}
                    disabled={uploadingSplash}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    {uploadingSplash ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-base" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <span>Upload Splash Screen</span>
                    )}
                  </button>
                  {user?.team?.splashPath && (
                    <button
                      onClick={() => handleRemove('splash')}
                      className="btn-ghost border border-border"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {user?.role === 'SUPER_ADMIN' && (
        <div className="card space-y-6">
          <div>
            <h2 className="text-md font-semibold text-txt-primary">System Organizations</h2>
            <p className="text-txt-secondary text-xs mt-1">
              Create and view isolated tenant organizations (Super Admin only).
            </p>
          </div>

          <form onSubmit={handleCreateOrg} className="flex gap-3 max-w-md">
            <input
              type="text"
              placeholder="New organization name"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              className="input flex-1"
              disabled={creatingOrg}
            />
            <button
              type="submit"
              disabled={creatingOrg || !newOrgName.trim()}
              className="btn-primary whitespace-nowrap"
            >
              {creatingOrg ? 'Creating...' : '+ Create Org'}
            </button>
          </form>

          <div className="border border-border rounded-xl overflow-hidden bg-surface/50">
            <table className="w-full text-left text-xs">
              <thead className="bg-border/30 text-txt-secondary uppercase tracking-wider font-bold">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">ID</th>
                  <th className="p-3">Tier</th>
                  <th className="p-3">Storage Quota</th>
                  <th className="p-3">Device Limit</th>
                  <th className="p-3">Upload (Ingress)</th>
                  <th className="p-3">Download (Egress)</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {orgs.map((org) => (
                  <tr key={org.id} className="hover:bg-border/20 transition-colors">
                    <td className="p-3 font-medium text-txt-primary flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-teal-glow border border-teal/20 flex items-center justify-center overflow-hidden">
                        {org.logoPath ? (
                          <img src={`/media/${org.logoPath}`} alt="" className="w-full h-full object-contain" />
                        ) : (
                          <span className="text-teal font-bold font-mono text-[10px]">O</span>
                        )}
                      </div>
                      <span>{org.name}</span>
                    </td>
                    <td className="p-3 font-mono text-txt-muted select-all">{org.id}</td>
                    <td className="p-3">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!org.isPremium}
                          onChange={() => handleTogglePremium(org.id, !!org.isPremium)}
                          className="rounded border-border bg-surface text-teal focus:ring-0 focus:ring-offset-0 h-4 w-4"
                        />
                        <span className={`text-[10px] font-semibold uppercase ${org.isPremium ? 'text-teal' : 'text-txt-secondary'}`}>
                          {org.isPremium ? '✨ Premium' : 'Standard'}
                        </span>
                      </label>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1 min-w-[150px]">
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="text-txt-primary font-medium">{formatBytes(org.storageUsed || 0)}</span>
                          <span className="text-txt-muted">/</span>
                          <span className="flex items-center gap-0.5">
                            <input
                              type="number"
                              step="0.01"
                              min="0.001"
                              value={editingQuota[org.id] !== undefined ? editingQuota[org.id] : ((org.maxStorage || 0) / (1024 ** 3)).toFixed(2)}
                              onChange={(e) => setEditingQuota(prev => ({ ...prev, [org.id]: e.target.value }))}
                              onBlur={(e) => handleUpdateQuota(org.id, parseFloat(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleUpdateQuota(org.id, parseFloat((e.target as HTMLInputElement).value))
                                  ;(e.target as HTMLInputElement).blur()
                                }
                              }}
                              className="w-12 bg-base border border-border/80 rounded px-1 py-0.5 text-center text-[10px] focus:border-teal text-txt-primary font-mono font-medium"
                            />
                            <span className="text-txt-muted text-[10px]">GB</span>
                          </span>
                        </div>
                        <div className="w-full bg-base rounded-full h-1 overflow-hidden border border-border/30">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              (org.storageUsed || 0) / (org.maxStorage || 1) > 0.9 ? 'bg-coral' : 'bg-teal'
                            }`}
                            style={{ width: `${Math.min(100, ((org.storageUsed || 0) / (org.maxStorage || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="1"
                          value={editingDevices[org.id] !== undefined ? editingDevices[org.id] : (org.maxDevices || 1)}
                          onChange={(e) => setEditingDevices(prev => ({ ...prev, [org.id]: e.target.value }))}
                          onBlur={(e) => handleUpdateDevices(org.id, parseInt(e.target.value))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleUpdateDevices(org.id, parseInt((e.target as HTMLInputElement).value))
                              ;(e.target as HTMLInputElement).blur()
                            }
                          }}
                          className="w-12 bg-base border border-border/80 rounded px-1.5 py-0.5 text-center text-[10px] focus:border-teal text-txt-primary font-mono font-medium"
                        />
                        <span className="text-txt-muted text-[10px]">screen(s)</span>
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1 min-w-[150px]">
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="text-txt-primary font-medium">{formatBytes(org.currentIngressMonthly || 0)}</span>
                          <span className="text-txt-muted">/</span>
                          <span className="flex items-center gap-0.5">
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={editingIngress[org.id] !== undefined ? editingIngress[org.id] : ((org.maxIngressMonthly || 0) / (1024 ** 3)).toFixed(1)}
                              onChange={(e) => setEditingIngress(prev => ({ ...prev, [org.id]: e.target.value }))}
                              onBlur={(e) => handleUpdateIngress(org.id, parseFloat(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleUpdateIngress(org.id, parseFloat((e.target as HTMLInputElement).value))
                                  ;(e.target as HTMLInputElement).blur()
                                }
                              }}
                              className="w-12 bg-base border border-border/80 rounded px-1 py-0.5 text-center text-[10px] focus:border-teal text-txt-primary font-mono font-medium"
                            />
                            <span className="text-txt-muted text-[10px]">GB</span>
                          </span>
                        </div>
                        <div className="w-full bg-base rounded-full h-1 overflow-hidden border border-border/30">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              (org.currentIngressMonthly || 0) / (org.maxIngressMonthly || 1) > 0.9 ? 'bg-coral' : 'bg-teal'
                            }`}
                            style={{ width: `${Math.min(100, ((org.currentIngressMonthly || 0) / (org.maxIngressMonthly || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1 min-w-[150px]">
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="text-txt-primary font-medium">{formatBytes(org.currentEgressMonthly || 0)}</span>
                          <span className="text-txt-muted">/</span>
                          <span className="flex items-center gap-0.5">
                            <input
                              type="number"
                              step="1"
                              min="1"
                              value={editingEgress[org.id] !== undefined ? editingEgress[org.id] : ((org.maxEgressMonthly || 0) / (1024 ** 3)).toFixed(0)}
                              onChange={(e) => setEditingEgress(prev => ({ ...prev, [org.id]: e.target.value }))}
                              onBlur={(e) => handleUpdateEgress(org.id, parseFloat(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleUpdateEgress(org.id, parseFloat((e.target as HTMLInputElement).value))
                                  ;(e.target as HTMLInputElement).blur()
                                }
                              }}
                              className="w-12 bg-base border border-border/80 rounded px-1 py-0.5 text-center text-[10px] focus:border-teal text-txt-primary font-mono font-medium"
                            />
                            <span className="text-txt-muted text-[10px]">GB</span>
                          </span>
                        </div>
                        <div className="w-full bg-base rounded-full h-1 overflow-hidden border border-border/30">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              (org.currentEgressMonthly || 0) / (org.maxEgressMonthly || 1) > 0.9 ? 'bg-coral' : 'bg-teal'
                            }`}
                            style={{ width: `${Math.min(100, ((org.currentEgressMonthly || 0) / (org.maxEgressMonthly || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="text-[10px] bg-teal-glow text-teal border border-teal/20 px-1.5 py-0.5 rounded font-medium">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
                {orgs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-txt-muted italic">
                      No organizations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
