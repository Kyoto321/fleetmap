import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // Static assets — cache first, serve from cache
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Job data — network first, fall through to cache on failure
            urlPattern: /\/api\/v1\/jobs/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-jobs-v1',
              networkTimeoutSeconds: 3,
              expiration: { maxAgeSeconds: 3600 },
            },
          },
          {
            // Auth endpoints — network only (never cache credentials)
            urlPattern: /\/api\/v1\/auth/,
            handler: 'NetworkOnly',
          },
          {
            // Mutation endpoints — handled by BackgroundSync plugin
            urlPattern: ({ request, url }) =>
              url.pathname.startsWith('/api/v1/jobs') &&
              ['POST', 'PATCH', 'PUT'].includes(request.method),
            handler: 'NetworkOnly',
            method: 'POST',
            options: {
              backgroundSync: {
                name: 'mutations-queue',
                options: {
                  maxRetentionTime: 72 * 60,  // 72 hours in minutes
                },
              },
            },
          },
        ],
      },
      manifest: {
        name: 'FleetOps Driver',
        short_name: 'FleetOps',
        description: 'Fleet job management for drivers — works offline',
        theme_color: '#1e293b',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        start_url: '/',
        scope: '/',
      },
    }),
  ],
  server: { port: 3001, host: true },
})
