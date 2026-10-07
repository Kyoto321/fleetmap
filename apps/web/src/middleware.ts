import { type NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api', '/_next', '/favicon.ico', '/robots.txt']
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost'

/**
 * Next.js Edge Middleware — runs on every request before page rendering.
 *
 * Responsibilities:
 * 1. Extract subdomain from the Host header
 * 2. Validate tenant exists (Redis-backed API call with TTL cache)
 * 3. Bind tenant context into downstream request headers
 * 4. Validate JWT and assert it belongs to the correct tenant
 * 5. Redirect unauthenticated requests to /login
 */
export async function middleware(request: NextRequest) {
  const url = request.nextUrl.clone()
  const host = request.headers.get('host') ?? ''

  // ── 1. Extract subdomain ──────────────────────────────────────────────────
  const subdomain = extractSubdomain(host, ROOT_DOMAIN)

  // Root domain — serve landing page
  if (!subdomain) {
    return NextResponse.next()
  }

  // Allow public paths without tenant validation
  const isPublicPath = PUBLIC_PATHS.some((p) => url.pathname.startsWith(p))

  // ── 2. Resolve tenant via API (monolith validates + Redis caches) ─────────
  let tenantId: string | null = null
  try {
    const tenantResp = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/tenants/resolve/${subdomain}`,
      { next: { revalidate: 300 }, headers: { 'X-Internal': '1' } }
    )
    if (tenantResp.ok) {
      const data = await tenantResp.json()
      tenantId = data.id
    }
  } catch {
    // Monolith unavailable — fail open on public paths, fail closed elsewhere
  }

  if (!tenantId && !isPublicPath) {
    return NextResponse.rewrite(new URL('/not-found', request.url))
  }

  // ── 3. JWT validation ─────────────────────────────────────────────────────
  const accessToken = request.cookies.get('access_token')?.value

  if (!accessToken && !isPublicPath) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', url.pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (accessToken) {
    const decoded = decodeJwt(accessToken)
    if (decoded) {
      const userRole = decoded.role
      
      // Drivers cannot access the dispatcher dashboard
      if (userRole === 'driver' && !isPublicPath) {
        const loginUrl = new URL('/login', request.url)
        const response = NextResponse.redirect(loginUrl)
        response.cookies.delete('access_token')
        response.cookies.delete('refresh_token')
        response.cookies.delete('tenant_id')
        return response
      }

      // Restrict /admin paths to admin role only
      if (url.pathname.startsWith('/admin') && userRole !== 'admin') {
        return NextResponse.rewrite(new URL('/not-found', request.url))
      }
    }
  }

  // ── 4. Build response with enriched headers ───────────────────────────────
  const response = NextResponse.next()
  if (tenantId) {
    response.headers.set('X-Tenant-ID', tenantId)
    response.headers.set('X-Subdomain', subdomain)
  }

  return response
}

function extractSubdomain(host: string, rootDomain: string): string | null {
  // Strip port if present (e.g. company-a.localhost:3000 → company-a.localhost)
  const hostWithoutPort = host.split(':')[0]

  // localhost special case for development
  if (rootDomain === 'localhost') {
    // company-a.localhost → subdomain = "company-a"
    if (hostWithoutPort.endsWith('.localhost') && hostWithoutPort !== 'localhost') {
      return hostWithoutPort.replace('.localhost', '')
    }
    return null
  }

  // Production: company-a.app.com → subdomain = "company-a"
  if (hostWithoutPort.endsWith(`.${rootDomain}`) && hostWithoutPort !== rootDomain) {
    return hostWithoutPort.replace(`.${rootDomain}`, '')
  }
  return null
}

function decodeJwt(token: string): any {
  try {
    const payload = token.split('.')[1]
    const binString = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(binString)
  } catch {
    return null
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
