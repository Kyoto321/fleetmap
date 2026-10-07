'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getAuthHeader() {
  const cookieStore = await cookies()
  const token = cookieStore.get('access_token')?.value
  return token ? { 'Cookie': `access_token=${token}` } : {}
}

export async function updateTenantAction(
  tenantId: string,
  payload: {
    name?: string
    branding?: {
      primary_color?: string
      logo_url?: string
    }
  }
) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to update settings' }
    }

    revalidatePath('/admin/settings')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}
