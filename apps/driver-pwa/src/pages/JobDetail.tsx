import React, { useRef, useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CachedJob, enqueueMutation } from '../db'
import { drainMutationsQueue } from '../sync/background-sync'

interface JobDetailProps {
  jobId: string
  onBack: () => void
  authToken: string
  subdomain: string
}

export default function JobDetail({ jobId, onBack, authToken, subdomain }: JobDetailProps) {
  const job = useLiveQuery(() => db.jobs_cache.get(jobId), [jobId])
  const [status, setStatus] = useState<string>('')
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)

  useEffect(() => {
    if (job) {
      setStatus(job.status)
      if (job.metadata?.signature) {
        setSignatureData(job.metadata.signature as string)
      }
    }
  }, [job])

  if (!job) {
    return (
      <div className="max-w-md mx-auto p-6 text-center text-slate-400">
        <p className="text-sm font-medium">Loading job details...</p>
        <button onClick={onBack} className="mt-4 text-purple-400 font-semibold hover:text-purple-300 transition border-none bg-transparent cursor-pointer">Back to List</button>
      </div>
    )
  }

  // Signature pad drawing functions
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    setIsDrawing(true)
    const pos = getEventCoords(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const pos = getEventCoords(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#1e293b'  // Professional dark ink color for the signature drawing line
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const getEventCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 }
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      }
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      setSignatureData(null)
    }
  }

  const saveSignature = () => {
    const canvas = canvasRef.current
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png')
      setSignatureData(dataUrl)
    }
  }

  const handleStatusChange = async (newStatus: string) => {
    setStatus(newStatus)

    const updatedMetadata = { ...job.metadata }
    if (newStatus === 'completed' && signatureData) {
      updatedMetadata.signature = signatureData
    }

    const updatedJob: CachedJob = {
      ...job,
      status: newStatus,
      metadata: updatedMetadata,
      version: job.version + 1,
      completed_at: newStatus === 'completed' ? new Date().toISOString() : job.completed_at,
    }

    // 1. Update IndexedDB locally (LWW first)
    await db.jobs_cache.put(updatedJob)

    // 2. Queue the mutation
    const trackingUuid = crypto.randomUUID()
    await enqueueMutation({
      tracking_uuid: trackingUuid,
      method: 'PATCH',
      endpoint: `http://localhost:8082/api/v1/jobs/${job.id}/sync`,
      payload: {
        status: newStatus,
        metadata: updatedMetadata,
        version: job.version + 1,
        completed_at: updatedJob.completed_at
      },
      client_timestamp: new Date().toISOString()
    })

    // 3. Trigger immediate sync if online
    if (navigator.onLine && authToken) {
      try {
        await drainMutationsQueue(authToken, subdomain)
      } catch (err) {
        console.error('Failed to trigger background sync:', err)
      }
    }
  }

  const getStatusBadge = (currentStatus: string) => {
    switch (currentStatus) {
      case 'assigned':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100">Assigned</span>
      case 'in_progress':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-100 animate-pulse">In Progress</span>
      case 'completed':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">Completed</span>
      case 'failed':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-100">Failed</span>
      default:
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-50 text-slate-600 border border-slate-100">{currentStatus}</span>
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 animate-fade-in flex flex-col gap-5">
      {/* Navigation */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors text-sm font-semibold mb-3 border-none bg-transparent cursor-pointer"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        Back to Jobs Feed
      </button>

      {/* Main Detail Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 flex flex-col gap-6 shadow-sm shadow-slate-100/50">
        <div className="flex items-center justify-between">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${
            job.priority >= 4 ? 'text-rose-600' :
            job.priority === 3 ? 'text-indigo-600' : 'text-blue-600'
          }`}>
            Priority {job.priority}
          </span>
          {getStatusBadge(status)}
        </div>

        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 leading-tight mb-2.5">{job.title}</h2>
          {job.description && (
            <p className="text-xs text-slate-500 leading-relaxed font-normal">{job.description}</p>
          )}
        </div>

        {job.delivery_address && (
          <div className="flex flex-col gap-2 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Delivery Destination</span>
            <div className="flex items-start gap-2.5 text-xs text-slate-700 mt-1 leading-normal">
              <svg className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
              <span>{(job.delivery_address as any).street}, {(job.delivery_address as any).city}</span>
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex flex-col gap-4 mt-2">
          {status === 'assigned' && (
            <button
              onClick={() => handleStatusChange('in_progress')}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl transition active:scale-[0.99] border-none shadow-sm cursor-pointer"
            >
              Start Delivery
            </button>
          )}

          {status === 'in_progress' && (
            <div className="flex flex-col gap-5">
              {/* Signature Capture Area */}
              {!signatureData ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider pl-1">Driver / Customer Signature</span>
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl overflow-hidden relative shadow-inner h-[160px] flex flex-col justify-end">
                    <canvas
                      ref={canvasRef}
                      width={380}
                      height={160}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                      className="absolute inset-0 w-full h-[160px] cursor-crosshair touch-none z-10"
                    />
                    <div className="absolute bottom-2.5 right-2.5 flex gap-2 z-20">
                      <button
                        onClick={clearSignature}
                        className="px-3 py-1.5 rounded-lg bg-white text-slate-700 text-[10px] font-bold uppercase tracking-wider hover:bg-slate-50 transition border border-slate-200 cursor-pointer"
                      >
                        Clear
                      </button>
                      <button
                        onClick={saveSignature}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-slate-800 transition border-none cursor-pointer"
                      >
                        Accept
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 animate-fade-in">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider pl-1">Captured Signature</span>
                  <div className="bg-white border border-slate-200/80 rounded-xl p-4 flex flex-col items-center gap-3">
                    <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl flex items-center justify-center min-w-[200px] min-h-[90px] shadow-inner relative">
                      <img src={signatureData} alt="Signature" className="max-h-[70px] max-w-[280px]" />
                    </div>
                    <button
                      onClick={() => setSignatureData(null)}
                      className="text-xs text-slate-500 hover:text-slate-800 font-semibold border-none bg-transparent cursor-pointer mt-0.5 transition"
                    >
                      Redo Signature
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => handleStatusChange('completed')}
                  disabled={!signatureData}
                  className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold text-sm rounded-xl transition active:scale-[0.99] border-none cursor-pointer shadow-sm disabled:shadow-none"
                >
                  Mark Completed
                </button>
                <button
                  onClick={() => handleStatusChange('failed')}
                  className="flex-1 py-3.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 hover:border-rose-300 font-bold text-sm rounded-xl transition active:scale-[0.99] cursor-pointer"
                >
                  Fail Delivery
                </button>
              </div>
            </div>
          )}

          {status === 'completed' && signatureData && (
            <div className="flex flex-col gap-3 bg-emerald-50 border border-emerald-250/20 p-5 rounded-2xl text-center animate-fade-in shadow-sm">
              <span className="text-emerald-800 text-sm font-bold flex items-center justify-center gap-1.5">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                </svg>
                Delivery Completed & Synced
              </span>
              <div className="bg-white border border-slate-200/80 p-2.5 rounded-xl flex items-center justify-center max-w-[240px] mx-auto shadow-sm mt-1">
                <img src={signatureData} alt="Signature" className="max-h-[50px] filter brightness-95 contrast-125" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
