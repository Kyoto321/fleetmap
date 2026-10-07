'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

export async function loginAction(_: { error?: string } | null, formData: FormData) {
  const email    = formData.get('email') as string
  const password = formData.get('password') as string

  const headersList = await headers()
  const host = headersList.get('host') ?? ''
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost'

  const hostWithoutPort = host.split(':')[0]
  let subdomain = ''
  if (rootDomain === 'localhost') {
    if (hostWithoutPort.endsWith('.localhost') && hostWithoutPort !== 'localhost') {
      subdomain = hostWithoutPort.replace('.localhost', '')
    }
  } else {
    if (hostWithoutPort.endsWith(`.${rootDomain}`) && hostWithoutPort !== rootDomain) {
      subdomain = hostWithoutPort.replace(`.${rootDomain}`, '')
    }
  }

  // Fallback: parse subdomain from test email domain when accessing via bare localhost (e.g. user@acme.demo -> acme)
  if (!subdomain && email && email.includes('@')) {
    const domainPart = email.split('@')[1]
    if (domainPart.endsWith('.demo')) {
      subdomain = domainPart.replace('.demo', '')
    }
  }

  if (!subdomain) {
    return { error: 'Missing tenant subdomain. Please access via http://<tenant-subdomain>.localhost:3000 or use a test email ending in .demo.' }
  }


  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'X-Subdomain': subdomain
    },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { error: err.detail ?? err.message ?? 'Invalid credentials. Please try again.' }
  }

  const data = await res.json()

  if (data?.user?.role === 'driver') {
    return { error: 'Access denied: drivers must use the mobile Driver PWA.' }
  }


  // Forward the cookies returned by the monolith API response to the Next.js client browser response
  const cookieStore = await cookies()
  const setCookies = res.headers.getSetCookie()
  for (const cookie of setCookies) {
    const parts = cookie.split(';')
    const [nameValue, ...attrs] = parts
    const idx = nameValue.indexOf('=')
    if (idx === -1) continue
    const name = nameValue.substring(0, idx).trim()
    const value = nameValue.substring(idx + 1).trim()
    
    const options: any = {}
    for (const attr of attrs) {
      const [attrName, attrValue] = attr.split('=').map(s => s.trim().toLowerCase())
      if (attrName === 'httponly') options.httpOnly = true
      if (attrName === 'secure') options.secure = true
      if (attrName === 'samesite') {
        if (attrValue === 'lax' || attrValue === 'strict' || attrValue === 'none') {
          options.sameSite = attrValue
        }
      }
      if (attrName === 'path') options.path = attrValue
      if (attrName === 'max-age') options.maxAge = parseInt(attrValue, 10)
    }
    cookieStore.set(name, value, options)
  }

  // Explicitly set the tenant_id cookie read by the dashboard pages
  if (data?.user?.tenant?.id) {
    cookieStore.set('tenant_id', data.user.tenant.id, { path: '/' })
  }

  redirect('/')
}

export async function logoutAction() {
  const cookieStore = await cookies()
  const token = cookieStore.get('access_token')?.value

  if (token) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Cookie': `access_token=${token}` },
      credentials: 'include',
    }).catch((err) => {
      console.error('Failed to call monolith logout endpoint:', err)
    })
  }

  cookieStore.delete('access_token')
  cookieStore.delete('refresh_token')
  cookieStore.delete('tenant_id')

  redirect('/login')
}

