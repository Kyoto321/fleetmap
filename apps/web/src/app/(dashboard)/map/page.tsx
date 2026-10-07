import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import MapWrapper from '@/components/map/MapWrapper'

export const metadata: Metadata = {
  title: 'Live Fleet Map — FleetOps',
  description: 'Real-time GPS tracking and route optimization for your fleet.',
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getMapData(tenantId: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    const headers: any = {
      'Cookie': `access_token=${token}`,
    }
    if (tenantId) {
      headers['X-Tenant-ID'] = tenantId
    }

    const [vehiclesRes, jobsRes, driversRes] = await Promise.all([
      fetch(`${API_URL}/api/v1/vehicles/?per_page=100`, { headers, next: { revalidate: 0 } }),
      fetch(`${API_URL}/api/v1/jobs/?per_page=100`, { headers, next: { revalidate: 0 } }),
      fetch(`${API_URL}/api/v1/auth/drivers`, { headers, next: { revalidate: 0 } }),
    ])

    const vehiclesData = vehiclesRes.ok ? await vehiclesRes.json() : { data: [] }
    const jobsData = jobsRes.ok ? await jobsRes.json() : { data: [] }
    const driversData = driversRes.ok ? await driversRes.json() : { data: [] }

    const vehicles = (vehiclesData.data || [])
      .filter((v: any) => v.last_position)
      .map((v: any) => ({
        id: v.id,
        registration: v.registration,
        status: v.status,
        longitude: v.last_position.longitude,
        latitude: v.last_position.latitude,
        assigned_driver_id: v.assigned_driver_id,
        make: v.make,
        model: v.model,
      }))

    return {
      vehicles,
      jobs: jobsData.data || [],
      drivers: driversData.data || [],
    }
  } catch (error) {
    console.error('Failed to fetch map view data:', error)
    return { vehicles: [], jobs: [], drivers: [] }
  }
}

export default async function MapPage() {
  const cookieStore  = await cookies()
  const tenantId     = cookieStore.get('tenant_id')?.value ?? ''
  const { vehicles, jobs, drivers } = await getMapData(tenantId)

  return (
    <div className="flex flex-col h-full gap-5">
      {/* Page Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
            Live Fleet Map
          </h1>
          <p className="text-sm text-slate-500 mt-1 font-normal">
            Real-time vehicle positions and route optimization schedules.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold shadow-sm relative">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping absolute shrink-0" />
            <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
            <span className="pl-1">{vehicles.length} active vehicles</span>
          </div>
        </div>
      </div>

      {/* Map Area */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200/80 rounded-2xl overflow-hidden relative shadow-sm">
        <MapWrapper 
          initialVehicles={vehicles} 
          initialJobs={jobs}
          drivers={drivers}
        />
      </div>
    </div>
  )
}
