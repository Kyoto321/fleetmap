import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import Link from 'next/link'
import TenantSettings from '@/components/admin/TenantSettings'

export const metadata: Metadata = {
  title: 'Workspace Settings — FleetOps',
  description: 'Manage branding configs, organization names, and system details.',
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getTenantData() {
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

    // Resolve tenant ID from /auth/me profile if cookie is missing
    let resolvedTenantId = tenantId
    if (!resolvedTenantId) {
      const meRes = await fetch(`${API_URL}/api/v1/auth/me`, { headers })
      if (meRes.ok) {
        const meData = await meRes.json()
        resolvedTenantId = meData.tenant_id
      }
    }

    if (!resolvedTenantId) {
      return { tenant: null }
    }

    const tenantRes = await fetch(`${API_URL}/api/v1/tenants/${resolvedTenantId}`, { headers })
    const tenantData = tenantRes.ok ? await tenantRes.json() : null

    return {
      tenant: tenantData
    }
  } catch (error) {
    console.error('Failed to load dashboard settings data:', error)
    return { tenant: null }
  }
}

export default async function SettingsPage() {
  const { tenant } = await getTenantData()

  if (!tenant) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] p-4">
        <div className="max-w-md w-full bg-rose-50 border border-rose-100 text-rose-800 text-xs rounded-xl p-4 font-semibold text-center shadow-sm">
          ⚠ Failed to load tenant configuration. Please verify your administrative session.
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 w-full max-w-3xl mx-auto py-8 px-4 md:px-8 flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-1 border-b border-slate-100 pb-5">
        <Link 
          href="/map" 
          className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 transition duration-150 mb-1 w-fit border-none outline-none"
        >
          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Live Map
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
          Workspace Settings
        </h1>
        <p className="text-sm text-slate-500 font-normal">
          Configure branding details, company names, and system metrics for your workspace.
        </p>
      </div>

      {/* Main Settings Panel */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm flex flex-col p-6 md:p-8">
        <TenantSettings tenant={tenant} />
      </div>
    </div>
  )
}
