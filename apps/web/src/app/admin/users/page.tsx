import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import Link from 'next/link'
import UsersManager from '@/components/admin/UsersManager'

export const metadata: Metadata = {
  title: 'Team Management — FleetOps',
  description: 'Manage dispatcher and driver credentials, roles, and platform permissions.',
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getTeamData() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    const tenantId = cookieStore.get('tenant_id')?.value

    const headers: any = {
      'Cookie': `access_token=${token}`,
    }
    if (tenantId) {
      headers['X-Tenant-ID'] = tenantId
    }

    const [usersRes, meRes] = await Promise.all([
      fetch(`${API_URL}/api/v1/users/?per_page=100`, { headers, next: { revalidate: 0 } }),
      fetch(`${API_URL}/api/v1/auth/me`, { headers, next: { revalidate: 0 } }),
    ])

    const usersData = usersRes.ok ? await usersRes.json() : { data: [] }
    const meData = meRes.ok ? await meRes.json() : { id: null }

    return {
      users: usersData.data || [],
      currentUser: meData,
    }
  } catch (error) {
    console.error('Failed to load dashboard team data:', error)
    return { users: [], currentUser: { id: null } }
  }
}

export default async function TeamPage() {
  const { users, currentUser } = await getTeamData()

  // Calculate statistics
  const total = users.length
  const admins = users.filter((u: any) => u.role === 'admin').length
  const dispatchers = users.filter((u: any) => u.role === 'dispatcher').length
  const drivers = users.filter((u: any) => u.role === 'driver').length
  const activeCount = users.filter((u: any) => u.is_active).length
  const inactiveCount = total - activeCount

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 shrink-0">
        <div>
          <Link 
            href="/map" 
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 transition duration-150 mb-1 w-fit border-none outline-none"
          >
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Live Map
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
            Team Management
          </h1>
          <p className="text-sm text-slate-500 mt-1 font-normal">
            Manage your company's admins, dispatchers, and drivers.
          </p>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 shrink-0">
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total Members</span>
          <span className="text-2xl font-bold text-slate-800 block mt-1">{total}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider block">Admins</span>
          <span className="text-2xl font-bold text-indigo-600 block mt-1">{admins}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider block">Dispatchers</span>
          <span className="text-2xl font-bold text-blue-600 block mt-1">{dispatchers}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-purple-600 font-bold uppercase tracking-wider block">Drivers</span>
          <span className="text-2xl font-bold text-purple-600 block mt-1">{drivers}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider block">Active Status</span>
          <span className="text-2xl font-bold text-emerald-600 block mt-1">
            {activeCount} <span className="text-xs text-slate-400 font-normal">/ {total}</span>
          </span>
        </div>
      </div>

      {/* Main Users Manager Panel */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200/85 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <UsersManager 
          initialUsers={users}
          currentUser={currentUser}
        />
      </div>
    </div>
  )
}
