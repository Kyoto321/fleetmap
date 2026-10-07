import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { WebSocketProvider } from '@/components/providers/WebSocketProvider'
import NavLink from '@/components/navigation/NavLink'
import { logoutAction } from '@/app/(auth)/login/actions'

const NAV_ITEMS = [
  { href: '/map',       iconType: 'map' as const,      label: 'Live Map' },
  { href: '/jobs',      iconType: 'jobs' as const,     label: 'Jobs' },
  { href: '/vehicles',  iconType: 'vehicles' as const, label: 'Vehicles' },
  { href: '/admin/users', iconType: 'team' as const,    label: 'Team', roles: ['admin'] },
  { href: '/admin/settings', iconType: 'settings' as const, label: 'Settings', roles: ['admin'] },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('access_token')?.value

  if (!accessToken) redirect('/login')

  // Parse subdomain from JWT token
  let subdomain = 'acme'
  try {
    const payload = accessToken.split('.')[1]
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'))
    subdomain = decoded.subdomain ?? 'acme'
  } catch {}

  // Fetch user metadata and tenant branding from monolith API
  let user = { role: 'dispatcher', email: 'user@company.com', full_name: 'Dispatcher' }
  let tenant = { name: 'Fleet Ops', subdomain }

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/me`, {
      headers: {
        'Cookie': `access_token=${accessToken}`
      },
      next: { revalidate: 300 } // Cache for 5 mins
    })
    if (res.ok) {
      const data = await res.json()
      user = {
        role: data.role,
        email: data.email,
        full_name: data.full_name
      }
      
      const tenantRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/tenants/resolve/${subdomain}`, {
        headers: { 'X-Internal': '1' },
        next: { revalidate: 300 }
      })
      if (tenantRes.ok) {
        const tenantData = await tenantRes.json()
        tenant = {
          name: tenantData.name,
          subdomain: tenantData.subdomain
        }
      }
    }
  } catch (err) {
    console.error('Failed to resolve authenticated session:', err)
  }

  const tenantName = tenant.name
  const tenantInitial = tenantName.charAt(0)
  const primaryColor = 'from-blue-600 to-indigo-600'

  // Filter navigation items based on user role
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true
    return item.roles.includes(user.role)
  })

  return (
    <WebSocketProvider token={accessToken}>
      <div className="grid grid-cols-[260px_1fr] min-h-screen bg-slate-50 text-slate-900 font-sans">
        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside className="bg-white border-r border-slate-200/85 flex flex-col p-5 sticky top-0 h-screen overflow-y-auto">
          {/* Logo */}
          <div className="flex items-center gap-3.5 mb-8 px-2">
            <div className={`w-9 h-9 bg-gradient-to-br ${primaryColor} rounded-xl flex items-center justify-center font-bold text-white text-sm shadow-md shadow-indigo-500/10`}>
              {tenantInitial}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight text-slate-950 leading-none">{tenantName}</span>
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">Fleet Management</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 flex flex-col gap-1.5">
            {visibleNavItems.map((item) => (
              <NavLink 
                key={item.href} 
                href={item.href} 
                iconType={item.iconType} 
                label={item.label} 
              />
            ))}
          </nav>

          {/* Bottom Profile / Actions Section */}
          <div className="border-t border-slate-200/80 pt-4 mt-4 flex flex-col gap-2">
            {/* User Profile Card */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200/60 mb-1">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs uppercase">
                {user.full_name.charAt(0)}
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-semibold text-slate-900 leading-none truncate">{user.full_name}</span>
                <span className="text-[10px] text-slate-500 leading-none truncate mt-1 capitalize">{user.role}</span>
              </div>
            </div>
            <LogoutButton />
          </div>
        </aside>


        {/* ── Main Content ──────────────────────────────────────────── */}
        <main className="p-6 md:p-8 overflow-y-auto h-screen flex flex-col bg-slate-50 relative">
          {/* Grid Background Pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-35 pointer-events-none" />
          <div className="relative z-10 flex-1 flex flex-col">
            {children}
          </div>
        </main>
      </div>
    </WebSocketProvider>
  )
}

function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button 
        type="submit" 
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-transparent transition-all duration-200 cursor-pointer"
      >
        <span className="text-slate-400 hover:text-rose-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
          </svg>
        </span>
        Sign out
      </button>
    </form>
  )
}
