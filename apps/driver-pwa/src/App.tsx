import React, { useState, useEffect } from 'react'
import JobList from './pages/JobList'
import JobDetail from './pages/JobDetail'

interface UserSession {
  email: string
  fullName: string
  role: string
  subdomain: string
  token: string
}

export default function App() {
  const [session, setSession] = useState<UserSession | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [loginEmail, setLoginEmail] = useState('driver1@acme.demo')
  const [loginPassword, setLoginPassword] = useState('demo1234')
  const [loginSubdomain, setLoginSubdomain] = useState('acme')
  const [loginError, setLoginError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Read session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('driver_session')
    if (saved) {
      try {
        setSession(JSON.parse(saved))
      } catch (e) {
        localStorage.removeItem('driver_session')
      }
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    setIsSubmitting(true)

    try {
      const res = await fetch(`http://localhost:8082/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Subdomain': loginSubdomain
        },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword
        }),
        credentials: 'include'
      })

      if (res.ok) {
        const data = await res.json()
        if (data.user.role !== 'driver') {
          setLoginError('Access denied: only drivers can login to the Driver PWA.')
          setIsSubmitting(false)
          return
        }

        const newSession: UserSession = {
          email: data.user.email,
          fullName: data.user.full_name,
          role: data.user.role,
          subdomain: loginSubdomain,
          token: 'cookie_auth' // Rely on HttpOnly cookies (credentials: 'include')
        }

        setSession(newSession)
        localStorage.setItem('driver_session', JSON.stringify(newSession))
      } else {
        const errData = await res.json()
        setLoginError(errData.detail || 'Login failed. Verify credentials and subdomain.')
      }
    } catch (err) {
      setLoginError('Could not reach backend auth server. Verify Docker stack is running.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogout = () => {
    setSession(null)
    localStorage.removeItem('driver_session')
    setSelectedJobId(null)
  }

  // Render Login screen
  if (!session) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 text-slate-900 relative overflow-hidden px-4 py-12">
        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-50" />

        <div className="w-full max-w-md bg-white border border-slate-200/80 rounded-2xl p-8 shadow-xl shadow-slate-200/50 relative z-10 animate-fade-in">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center mx-auto mb-4 shadow-sm">
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Driver Portal</h1>
            <p className="text-xs text-slate-500 mt-1.5 font-normal">Enter your dispatcher-assigned credentials</p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider pl-1">Workspace Subdomain</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3a2.25 2.25 0 0 1 2.25-2.25h3a2.25 2.25 0 0 1 2.25 2.25v3m-3-12h.008v.008H12V9.75Zm0 3h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm3.75-5.25h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
                  </svg>
                </span>
                <input
                  type="text"
                  required
                  value={loginSubdomain}
                  onChange={(e) => setLoginSubdomain(e.target.value)}
                  placeholder="acme"
                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition duration-200"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider pl-1">Email Address</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                </span>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="driver1@acme.demo"
                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition duration-200"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider pl-1">Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </span>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition duration-200"
                />
              </div>
            </div>

            {loginError && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-rose-50 border border-rose-100 text-rose-800 text-xs rounded-xl text-center">
                <svg className="w-4 h-4 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3Z" />
                </svg>
                <span className="font-semibold text-[11px] leading-normal">{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl mt-2 transition active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none shadow-sm border-none cursor-pointer"
            >
              {isSubmitting ? 'Verifying...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Render main driver workspace
  return (
    <div className="min-h-screen bg-slate-50 pb-12 relative overflow-hidden font-sans">
      {/* Top Navbar */}
      <nav className="bg-white border-b border-slate-200/80 sticky top-0 z-50 px-4 py-3 shadow-sm shadow-slate-100">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-800 leading-none">{session.fullName}</span>
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">{session.role}</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2.5 rounded-xl bg-slate-50 text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 transition-all duration-200 active:scale-95 cursor-pointer"
            title="Log Out"
          >
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Page Routing */}
      <main className="relative z-10">
        {selectedJobId ? (
          <JobDetail
            jobId={selectedJobId}
            onBack={() => setSelectedJobId(null)}
            authToken={session.token}
            subdomain={session.subdomain}
          />
        ) : (
          <JobList
            onSelectJob={(id) => setSelectedJobId(id)}
            authToken={session.token}
            subdomain={session.subdomain}
          />
        )}
      </main>
    </div>
  )
}
