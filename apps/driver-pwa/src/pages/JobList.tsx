import React, { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CachedJob, getJobsByStatus } from '../db'
import { drainMutationsQueue } from '../sync/background-sync'

interface JobListProps {
  onSelectJob: (id: string) => void
  authToken: string
  subdomain: string
}

export default function JobList({ onSelectJob, authToken, subdomain }: JobListProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [filter, setFilter] = useState<string>('all')

  // Live query from IndexedDB
  const jobs = useLiveQuery(
    async () => {
      if (filter === 'all') {
        return db.jobs_cache.orderBy('scheduled_at').toArray()
      }
      return getJobsByStatus(filter)
    },
    [filter]
  )

  const pendingMutationsCount = useLiveQuery(
    () => db.mutations_queue.count(),
    []
  )

  // Listen to network status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Sync mutations when we go online
  useEffect(() => {
    if (isOnline && pendingMutationsCount && pendingMutationsCount > 0 && authToken) {
      handleSync()
    }
  }, [isOnline, pendingMutationsCount, authToken])

  const handleSync = async () => {
    if (!authToken) return
    setSyncStatus('syncing')
    try {
      const res = await drainMutationsQueue(authToken, subdomain)
      if (res.errors.length > 0) {
        setSyncStatus('error')
        setSyncMessage(`Synced ${res.synced} jobs. Errors: ${res.errors.join(', ')}`)
      } else {
        setSyncStatus('success')
        setSyncMessage(`Successfully synced ${res.synced} modifications!`)
        setTimeout(() => setSyncStatus('idle'), 3000)
      }
      await fetchJobsFromServer()
    } catch (err) {
      setSyncStatus('error')
      setSyncMessage('Sync failed. Will retry when connection stabilizes.')
    }
  }

  const fetchJobsFromServer = async () => {
    if (!isOnline || !authToken) return
    try {
      const res = await fetch(`http://localhost:8082/api/v1/jobs/`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-Subdomain': subdomain
        },
        credentials: 'include'
      })
      if (res.ok) {
        const responseData = await res.json()
        const jobsArray = Array.isArray(responseData) ? responseData : (responseData?.data ?? [])
        await db.jobs_cache.clear()
        const now = new Date().toISOString()
        await db.jobs_cache.bulkPut(
          jobsArray.map((j: any) => ({
            id: j.id,
            tenant_id: j.tenant_id,

            title: j.title,
            description: j.description,
            status: j.status,
            priority: j.priority,
            scheduled_at: j.scheduled_at,
            completed_at: j.completed_at,
            driver_id: j.driver_id,
            vehicle_id: j.vehicle_id,
            delivery_address: j.delivery_address,
            version: j.version,
            server_updated_at: j.server_updated_at || now,
            metadata: j.metadata || {},
            synced_at: now
          }))
        )
      }
    } catch (err) {
      console.error('Failed to pull jobs from server:', err)
    }
  }

  // Pull initial data if online
  useEffect(() => {
    if (isOnline && authToken) {
      fetchJobsFromServer()
    }
  }, [authToken])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'assigned':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100">Assigned</span>
      case 'in_progress':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-100 animate-pulse">In Progress</span>
      case 'completed':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">Completed</span>
      case 'failed':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-100">Failed</span>
      default:
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-50 text-slate-600 border border-slate-100">{status}</span>
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 animate-fade-in flex flex-col gap-6">
      {/* Header Info Panel */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 flex flex-col gap-4 shadow-sm shadow-slate-100/50">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Workspace</span>
            <span className="text-lg font-bold tracking-tight text-slate-900 capitalize mt-0.5">{subdomain} Logistics</span>
          </div>
          
          {isOnline ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Online
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Offline
            </span>
          )}
        </div>

        {/* Sync queue notification */}
        {pendingMutationsCount !== undefined && pendingMutationsCount > 0 && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              <span>{pendingMutationsCount} offline modifications pending sync</span>
            </div>
            {isOnline && (
              <button
                onClick={handleSync}
                disabled={syncStatus === 'syncing'}
                className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] transition active:scale-95 disabled:opacity-50 border-none cursor-pointer"
              >
                {syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
              </button>
            )}
          </div>
        )}

        {syncStatus !== 'idle' && (
          <div className={`p-3 rounded-xl text-xs flex items-center gap-2.5 ${
            syncStatus === 'syncing' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' :
            syncStatus === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
            'bg-rose-50 text-rose-700 border border-rose-100'
          }`}>
            {syncStatus === 'syncing' ? (
              <>
                <svg className="w-3.5 h-3.5 text-indigo-600 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Synchronizing offline changes...</span>
              </>
            ) : (
              <>
                <span className="shrink-0">{syncStatus === 'success' ? '✓' : '⚠'}</span>
                <span>{syncMessage}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Segmented Filter Control */}
      <div className="bg-slate-100 p-1 border border-slate-200/60 rounded-xl flex gap-1 overflow-x-auto">
        {['all', 'assigned', 'in_progress', 'completed'].map((statusOption) => {
          const isActive = filter === statusOption
          return (
            <button
              key={statusOption}
              onClick={() => setFilter(statusOption)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-all duration-200 border-none cursor-pointer ${
                isActive
                  ? 'bg-white border border-slate-250/20 text-slate-800 shadow-sm font-bold'
                  : 'bg-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {statusOption.replace('_', ' ')}
            </button>
          )
        })}
      </div>

      {/* Jobs List */}
      <div className="flex flex-col gap-4">
        {jobs === undefined ? (
          <div className="text-center text-slate-400 py-8 text-xs font-medium tracking-wide">
            Loading local cache...
          </div>
        ) : jobs.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl p-8 text-center text-slate-400 border border-dashed border-slate-200">
            <svg className="w-10 h-10 text-slate-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <p className="text-sm font-semibold text-slate-700">No jobs assigned</p>
            <p className="text-xs text-slate-400 mt-1">Jobs synced from the server will appear here.</p>
          </div>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              onClick={() => onSelectJob(job.id)}
              className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-5 cursor-pointer flex flex-col gap-3 relative overflow-hidden transition active:scale-[0.98] duration-150 shadow-sm shadow-slate-100/50"
            >
              {/* Left Color-coded Priority Bar */}
              <div className={`absolute top-0 left-0 bottom-0 w-1 ${
                job.priority >= 4 ? 'bg-rose-500' :
                job.priority === 3 ? 'bg-indigo-500' : 'bg-blue-500'
              }`} />

              <div className="flex items-start justify-between pl-1">
                <div className="flex flex-col gap-0.5">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${
                    job.priority >= 4 ? 'text-rose-600' :
                    job.priority === 3 ? 'text-indigo-600' : 'text-blue-600'
                  }`}>
                    Priority {job.priority}
                  </span>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight leading-snug mt-0.5">{job.title}</h3>
                </div>
                {getStatusBadge(job.status)}
              </div>

              {job.description && (
                <p className="text-xs text-slate-500 pl-1 line-clamp-2 leading-relaxed">{job.description}</p>
              )}

              {job.delivery_address && (
                <div className="flex items-center gap-2 pl-1 text-[11px] text-slate-500 mt-1 bg-slate-50 p-3 rounded-xl border border-slate-200/50">
                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="truncate">{(job.delivery_address as any).street}, {(job.delivery_address as any).city}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
