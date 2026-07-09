import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../lib/api'

export default function ForgotPassword() {
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch {
      toast.error('Something went wrong — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-glow border border-teal/30 mb-4">
            <span className="text-teal text-xl font-bold font-mono">S</span>
          </div>
          <h1 className="text-xl font-semibold">Reset password</h1>
          <p className="text-txt-secondary text-sm mt-1">
            {sent ? 'Check your inbox' : "We'll send a reset link to your email"}
          </p>
        </div>

        {sent ? (
          <div className="card text-center space-y-3">
            <div className="text-3xl">📬</div>
            <p className="text-sm text-txt-secondary">
              If <span className="text-txt-primary">{email}</span> has an account, a reset link is on its way. Check your spam folder if you don't see it.
            </p>
            <p className="text-xs text-txt-muted">The link expires in 1 hour.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-4">
            <div>
              <label className="block text-xs text-txt-secondary mb-1.5">Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="input" placeholder="you@example.com" required autoFocus
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Sending…' : 'Send reset link'}
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
