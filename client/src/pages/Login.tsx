import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuth } from '../lib/store'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const { setUser } = useAuth()
  const navigate    = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('access_token',  data.access)
      localStorage.setItem('refresh_token', data.refresh)
      setUser(data.user)
      navigate('/dashboard')
    } catch { toast.error('Invalid email or password') }
    finally  { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-glow border border-teal/30 mb-4">
            <span className="text-teal text-xl font-bold font-mono">S</span>
          </div>
          <h1 className="text-xl font-semibold">Signage</h1>
          <p className="text-txt-muted text-xs font-medium">by TableView Media</p>
          <p className="text-txt-secondary text-sm mt-2">Sign in to continue</p>
        </div>
        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="input" placeholder="you@company.com" required autoFocus />
          </div>
          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="input" placeholder="••••••••" required />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-xs text-txt-muted mt-6 flex flex-col gap-2">
          <div>
            <span className="text-txt-muted">Don't have an account? </span>
            <Link to="/register" className="text-teal font-medium hover:underline">Sign up</Link>
          </div>
          <div className="flex items-center justify-center gap-2 mt-1">
            <Link to="/forgot-password" className="text-txt-secondary hover:text-teal transition-colors">Forgot password?</Link>
            <span>·</span>
            <Link to="/privacy" className="text-txt-secondary hover:text-teal transition-colors">Privacy Policy</Link>
          </div>
        </p>
      </div>
    </div>
  )
}
