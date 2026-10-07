import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: { default: 'FleetOps — Real-Time Fleet Management', template: '%s | FleetOps' },
  description:
    'Enterprise fleet management and telemetry platform. Track vehicles, manage jobs, and monitor assets in real time.',
  keywords: ['fleet management', 'GPS tracking', 'telemetry', 'logistics'],
  robots: { index: false, follow: false },  // SaaS app — no public indexing
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased bg-slate-50 text-slate-900 min-h-screen">
        {children}
      </body>
    </html>
  )
}
