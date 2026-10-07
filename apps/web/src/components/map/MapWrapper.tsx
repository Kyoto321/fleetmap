'use client'

import dynamic from 'next/dynamic'

const FleetMap = dynamic<{ 
  initialVehicles: any
  initialJobs: any
  drivers: any
}>(() => import('./FleetMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full rounded-2xl bg-slate-900/80 animate-pulse flex items-center justify-center border border-slate-800/50">
      <div className="flex flex-col items-center gap-3">
        <svg className="w-8 h-8 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-xs text-slate-500 font-semibold tracking-widest uppercase">Initializing map canvas...</span>
      </div>
    </div>
  ),
})

interface MapWrapperProps {
  initialVehicles: any
  initialJobs: any
  drivers: any
}

export default function MapWrapper({ initialVehicles, initialJobs, drivers }: MapWrapperProps) {
  return (
    <FleetMap 
      initialVehicles={initialVehicles} 
      initialJobs={initialJobs}
      drivers={drivers}
    />
  )
}
