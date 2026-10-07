'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getAuthHeader() {
  const cookieStore = await cookies()
  const token = cookieStore.get('access_token')?.value
  return token ? { 'Cookie': `access_token=${token}` } : {}
}

export async function createJobAction(payload: {
  title: string
  description?: string
  vehicle_id?: string
  driver_id?: string
  scheduled_at?: string
  priority: number
  delivery_address?: {
    street: string
    city: string
    latitude: number
    longitude: number
  }
}) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/jobs/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify({
        title: payload.title,
        description: payload.description || null,
        vehicle_id: payload.vehicle_id || null,
        driver_id: payload.driver_id || null,
        scheduled_at: payload.scheduled_at ? new Date(payload.scheduled_at).toISOString() : null,
        priority: payload.priority,
        pickup_address: null,
        delivery_address: payload.delivery_address || null,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to create job' }
    }

    revalidatePath('/jobs')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}

export async function updateJobAction(
  jobId: string,
  payload: {
    status?: string
    priority?: number
    driver_id?: string | null
    vehicle_id?: string | null
    scheduled_at?: string | null
    description?: string
    delivery_address?: {
      street: string
      city: string
      latitude: number
      longitude: number
    }
  }
) {
  try {
    const authHeader = await getAuthHeader()
    
    // Map empty string to null for driver/vehicle
    const body: any = { ...payload }
    if (body.driver_id === '') body.driver_id = null
    if (body.vehicle_id === '') body.vehicle_id = null
    if (body.scheduled_at) {
      body.scheduled_at = new Date(body.scheduled_at).toISOString()
    } else if (body.scheduled_at === '') {
      body.scheduled_at = null
    }

    const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to update job' }
    }

    revalidatePath('/jobs')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}

export async function deleteJobAction(jobId: string) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}`, {
      method: 'DELETE',
      headers: {
        ...authHeader,
      },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to delete job' }
    }

    revalidatePath('/jobs')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}

export async function optimizeRouteAction(orderedJobIds: string[]) {
  try {
    const authHeader = await getAuthHeader()
    // Stagger scheduled times starting from now in 30-minute intervals
    const now = new Date()
    
    for (let i = 0; i < orderedJobIds.length; i++) {
      const jobId = orderedJobIds[i]
      const scheduledTime = new Date(now.getTime() + i * 30 * 60 * 1000).toISOString()
      
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({ scheduled_at: scheduledTime }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return { success: false, error: err.detail || `Failed to update job order for step ${i + 1}` }
      }
    }

    revalidatePath('/map')
    revalidatePath('/jobs')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}
