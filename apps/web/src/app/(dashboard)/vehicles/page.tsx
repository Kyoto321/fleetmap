import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import Link from 'next/link'
import VehiclesManager from '@/components/vehicles/VehiclesManager'

export const metadata: Metadata = {
  title: 'Vehicles Fleet — FleetOps',
  description: 'Monitor registration status and driver assignments for your fleet.',
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getVehiclesData() {
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

    // Fetch vehicles and drivers concurrently
    const [vehiclesRes, driversRes] = await Promise.all([
      fetch(`${API_URL}/api/v1/vehicles/?per_page=100`, { headers, next: { revalidate: 0 } }),
      fetch(`${API_URL}/api/v1/auth/drivers`, { headers, next: { revalidate: 0 } }),
    ])

    const vehiclesData = vehiclesRes.ok ? await vehiclesRes.json() : { data: [] }
    const driversData = driversRes.ok ? await driversRes.json() : { data: [] }

    return {
      vehicles: vehiclesData.data || [],
      drivers: driversData.data || [],
    }
  } catch (error) {
    console.error('Failed to load dashboard vehicles data:', error)
    return { vehicles: [], drivers: [] }
  }
}

export default async function VehiclesPage() {
  const { vehicles, drivers } = await getVehiclesData()

  // Calculate statistics
  const total = vehicles.length
  const idle = vehicles.filter((v: any) => v.status === 'idle').length
  const enRoute = vehicles.filter((v: any) => v.status === 'en_route').length
  const maintenance = vehicles.filter((v: any) => v.status === 'maintenance').length
  const offline = vehicles.filter((v: any) => v.status === 'offline').length

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
            Vehicles Fleet
          </h1>
          <p className="text-sm text-slate-500 mt-1 font-normal">
            Monitor, assign drivers, and manage registration details for your fleet vehicles.
          </p>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 shrink-0">
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total Fleet</span>
          <span className="text-2xl font-bold text-slate-800 block mt-1">{total}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider block">Idle</span>
          <span className="text-2xl font-bold text-emerald-600 block mt-1">{idle}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider block">En Route</span>
          <span className="text-2xl font-bold text-blue-600 block mt-1">{enRoute}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-amber-600 font-bold uppercase tracking-wider block">Maintenance</span>
          <span className="text-2xl font-bold text-amber-600 block mt-1">{maintenance}</span>
        </div>
        <div className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Offline</span>
          <span className="text-2xl font-bold text-slate-500 block mt-1">{offline}</span>
        </div>
      </div>

      {/* Main Vehicles Manager Panel */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200/85 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <VehiclesManager 
          initialVehicles={vehicles} 
          drivers={drivers} 
        />
      </div>
    </div>
  )
}
