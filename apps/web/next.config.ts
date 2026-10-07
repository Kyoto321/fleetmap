import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Enable wildcard subdomain support
  // In production: *.app.com maps to the same Next.js app
  async rewrites() {
    return []
  },
  // Image domains for tenant logos served from external sources
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: 'cdn.jsdelivr.net' },
    ],
  },
  // Environment variables available to client-side code
  env: {
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '',
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000',
    NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost',
  },
}

export default nextConfig
