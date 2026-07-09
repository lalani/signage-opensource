import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../lib/api'

export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [password,  setPassword]  = useState('')
  const [password2, setPassword2] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== password2) { toast.error('Passwords do not match'); return }
    if (password.length < 8)    { toast.error('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Reset failed — the link may have expired')
    } finally {
      setLoading(false)
    }
  }

  if (!token) return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="card text-center max-w-sm w-full space-y-3">
        <div className="text-3xl">⚠️</div>
        <p className="text-sm text-txt-secondary">Invalid reset link. Please request a new one.</p>
        <Link to="/forgot-password" className="btn-primary inline-block text-sm">Request new link</Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-glow border border-teal/30 mb-4">
            <span className="text-teal text-xl font-bold font-mono">S</span>
          </div>
          <h1 className="text-xl font-semibold">Choose a new password</h1>
        </div>

        {done ? (
          <div className="card text-center space-y-2">
            <div className="text-3xl">✓</div>
            <p className="text-sm text-txt-secondary">Password updated — redirecting to sign in…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-4">
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">New password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="input" placeholder="Min 8 characters" required autoFocus />
            </div>
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">Confirm password</label>
              <input type="password" value={password2} onChange={e => setPassword2(e.target.value)}
                className="input" placeholder="Same password again" required />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-txt-muted mt-6">
          <Link to="/login" className="text-txt-secondary hover:text-teal transition-colors">← Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
