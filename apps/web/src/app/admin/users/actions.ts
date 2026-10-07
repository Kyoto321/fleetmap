'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8082'

async function getAuthHeader() {
  const cookieStore = await cookies()
  const token = cookieStore.get('access_token')?.value
  return token ? { 'Cookie': `access_token=${token}` } : {}
}

export async function createUserAction(payload: {
  email: string
  password?: string
  full_name: string
  role: string
}) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/users/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to create user' }
    }

    revalidatePath('/admin/users')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}

export async function updateUserAction(
  userId: string,
  payload: {
    full_name?: string
    role?: string
    is_active?: boolean
  }
) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to update user' }
    }

    revalidatePath('/admin/users')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}

export async function deleteUserAction(userId: string) {
  try {
    const authHeader = await getAuthHeader()
    const res = await fetch(`${API_URL}/api/v1/users/${userId}`, {
      method: 'DELETE',
      headers: {
        ...authHeader,
      },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.detail || 'Failed to delete user' }
    }

    revalidatePath('/admin/users')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Server connection error' }
  }
}
