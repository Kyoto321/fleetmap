'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getAuthHeader() {
  const cookieStore = await cookies()
  const token = cookieStore.get('access_token')?.value
  return token ? { 'Cookie': `access_token=${token}` } : {}
}

export async function createVehicleAction(payload: {
  registration: string
  make?: string
  model?: string
  year?: number
}) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/vehicles/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to create vehicle' }
    }

    revalidatePath('/vehicles')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}

export async function updateVehicleAction(
  vehicleId: string,
  payload: {
    status?: string
    assigned_driver_id?: string | null
    make?: string
    model?: string
  }
) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/vehicles/${vehicleId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to update vehicle' }
    }

    revalidatePath('/vehicles')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}

export async function deleteVehicleAction(vehicleId: string) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/vehicles/${vehicleId}`, {
      method: 'DELETE',
      headers: {
        ...authHeader,
      },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to delete vehicle' }
    }

    revalidatePath('/vehicles')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}
