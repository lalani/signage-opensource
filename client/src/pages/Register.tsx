import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuth } from '../lib/store'

export default function Register() {
  const [name, setName]               = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [loading, setLoading]         = useState(false)
  const { setUser } = useAuth()
  const navigate    = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/auth/register', {
        name,
        companyName,
        email,
        password
      })
      localStorage.setItem('access_token',  data.access)
      localStorage.setItem('refresh_token', data.refresh)
      setUser(data.user)
      toast.success('Account created successfully!')
      navigate('/dashboard')
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to create account. Please try again.'
      toast.error(msg)
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
          <h1 className="text-xl font-semibold">Create Account</h1>
          <p className="text-txt-muted text-xs font-medium">by TableView Media</p>
          <p className="text-txt-secondary text-sm mt-2">Get started with Open Source Signage</p>
        </div>

        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="input"
              placeholder="John Doe"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Company / Organization Name</label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              className="input"
              placeholder="Acme Corp"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input"
              placeholder="john@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-txt-secondary mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input"
              placeholder="•••••••• (min. 6 characters)"
              minLength={6}
              required
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
            {loading ? 'Creating account…' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-xs text-txt-muted mt-6 flex flex-col gap-2">
          <div>
            <span className="text-txt-muted">Already have an account? </span>
            <Link to="/login" className="text-teal font-medium hover:underline">Sign in</Link>
          </div>
          <div className="flex items-center justify-center gap-2 mt-1">
            <Link to="/privacy" className="text-txt-secondary hover:text-teal transition-colors">Privacy Policy</Link>
          </div>
        </p>
      </div>
    </div>
  )
}
