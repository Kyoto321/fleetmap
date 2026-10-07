import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import JobsManager from '@/components/jobs/JobsManager'

export const metadata: Metadata = {
  title: 'Jobs Management — FleetOps',
  description: 'Manage, schedule, and dispatch fleet delivery jobs.',
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getJobsData() {
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

    // Fetch jobs, vehicles, and drivers concurrently
    const [jobsRes, vehiclesRes, driversRes] = await Promise.all([
      fetch(`${API_URL}/api/v1/jobs/?per_page=100`, { headers, next: { revalidate: 0 } }),
      fetch(`${API_URL}/api/v1/vehicles/?per_page=100`, { headers, next: { revalidate: 0 } }),
      fetch(`${API_URL}/api/v1/auth/drivers`, { headers, next: { revalidate: 0 } }),
    ])

    const jobsData = jobsRes.ok ? await jobsRes.json() : { data: [] }
    const vehiclesData = vehiclesRes.ok ? await vehiclesRes.json() : { data: [] }
    const driversData = driversRes.ok ? await driversRes.json() : { data: [] }

    return {
      jobs: jobsData.data || [],
      vehicles: vehiclesData.data || [],
      drivers: driversData.data || [],
    }
  } catch (error) {
    console.error('Failed to load dashboard jobs data:', error)
    return { jobs: [], vehicles: [], drivers: [] }
  }
}

export default async function JobsPage() {
  const { jobs, vehicles, drivers } = await getJobsData()

  // Calculate statistics
  const total = jobs.length
  const pending = jobs.filter((j: any) => j.status === 'pending').length
  const assigned = jobs.filter((j: any) => j.status === 'assigned').length
  const inProgress = jobs.filter((j: any) => j.status === 'in_progress').length
  const completed = jobs.filter((j: any) => j.status === 'completed').length
  const failed = jobs.filter((j: any) => j.status === 'failed').length

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
            Jobs Management
          </h1>
          <p className="text-sm text-slate-500 mt-1 font-normal">
            Create, assign, schedule, and track delivery jobs.
          </p>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 shrink-0">
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total Jobs</span>
          <span className="text-2xl font-bold text-slate-800 block mt-1">{total}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-amber-600 font-bold uppercase tracking-wider block">Pending</span>
          <span className="text-2xl font-bold text-amber-600 block mt-1">{pending}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider block">Assigned</span>
          <span className="text-2xl font-bold text-blue-600 block mt-1">{assigned}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-purple-600 font-bold uppercase tracking-wider block">In Progress</span>
          <span className="text-2xl font-bold text-purple-600 block mt-1">{inProgress}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider block">Completed</span>
          <span className="text-2xl font-bold text-emerald-600 block mt-1">{completed}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-rose-600 font-bold uppercase tracking-wider block">Failed</span>
          <span className="text-2xl font-bold text-rose-600 block mt-1">{failed}</span>
        </div>
      </div>

      {/* Main Jobs Manager Panel */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200/85 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <JobsManager 
          initialJobs={jobs} 
          vehicles={vehicles} 
          drivers={drivers} 
        />
      </div>
    </div>
  )
}
