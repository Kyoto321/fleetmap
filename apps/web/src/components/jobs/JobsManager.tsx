'use client'

import { useState, useTransition } from 'react'
import { createJobAction, updateJobAction, deleteJobAction } from '@/app/(dashboard)/jobs/actions'

interface Vehicle {
  id: string
  registration: string
  make?: string
  model?: string
  status: string
}

interface Driver {
  id: string
  full_name: string
  email: string
}

interface Job {
  id: string
  title: string
  status: string
  priority: number
  vehicle_id: string | null
  driver_id: string | null
  scheduled_at: string | null
  completed_at: string | null
  version: number
  metadata: any
  delivery_address: {
    street: string
    city: string
    latitude: number
    longitude: number
  } | null
}

interface JobsManagerProps {
  initialJobs: Job[]
  vehicles: Vehicle[]
  drivers: Driver[]
}

export default function JobsManager({ initialJobs, vehicles, drivers }: JobsManagerProps) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [isPending, startTransition] = useTransition()

  // Modal States
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)

  // Form State - Create
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPriority, setNewPriority] = useState(3)
  const [newVehicle, setNewVehicle] = useState('')
  const [newDriver, setNewDriver] = useState('')
  const [newScheduled, setNewScheduled] = useState('')
  const [newStreet, setNewStreet] = useState('')
  const [newCity, setNewCity] = useState('')
  const [formError, setFormError] = useState('')

  // Form State - Edit
  const [editStatus, setEditStatus] = useState('pending')
  const [editPriority, setEditPriority] = useState(3)
  const [editVehicle, setEditVehicle] = useState('')
  const [editDriver, setEditDriver] = useState('')
  const [editScheduled, setEditScheduled] = useState('')
  const [editStreet, setEditStreet] = useState('')
  const [editCity, setEditCity] = useState('')

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!newTitle.trim()) {
      setFormError('Job Title is required')
      return
    }

    startTransition(async () => {
      const payload: any = {
        title: newTitle,
        description: newDesc || undefined,
        priority: Number(newPriority),
        vehicle_id: newVehicle || undefined,
        driver_id: newDriver || undefined,
        scheduled_at: newScheduled || undefined,
      }

      if (newStreet.trim() || newCity.trim()) {
        payload.delivery_address = {
          street: newStreet,
          city: newCity,
          latitude: 51.5074, // Default placeholder coordinates
          longitude: -0.1278,
        }
      }

      const res = await createJobAction(payload)
      if (res.success) {
        // Optimistic refresh (revalidatePath will update server component page, but let's close modal & reset)
        setCreateModalOpen(false)
        resetCreateForm()
        window.location.reload() // Simple reload to get fresh props
      } else {
        setFormError(res.error || 'Failed to create job')
      }
    })
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingJob) return

    startTransition(async () => {
      const payload: any = {
        status: editStatus,
        priority: Number(editPriority),
        driver_id: editDriver || null,
        vehicle_id: editVehicle || null,
        scheduled_at: editScheduled || null,
      }

      if (editStreet.trim() || editCity.trim()) {
        payload.delivery_address = {
          street: editStreet,
          city: editCity,
          latitude: editingJob.delivery_address?.latitude || 51.5074,
          longitude: editingJob.delivery_address?.longitude || -0.1278,
        }
      }

      const res = await updateJobAction(editingJob.id, payload)
      if (res.success) {
        setEditModalOpen(false)
        setEditingJob(null)
        window.location.reload()
      } else {
        alert(res.error || 'Failed to update job')
      }
    })
  }

  const handleDelete = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this job?')) return

    startTransition(async () => {
      const res = await deleteJobAction(jobId)
      if (res.success) {
        window.location.reload()
      } else {
        alert(res.error || 'Failed to delete job')
      }
    })
  }

  const openEditModal = (job: Job) => {
    setEditingJob(job)
    setEditStatus(job.status)
    setEditPriority(job.priority)
    setEditVehicle(job.vehicle_id || '')
    setEditDriver(job.driver_id || '')
    setEditScheduled(job.scheduled_at ? job.scheduled_at.substring(0, 16) : '')
    setEditStreet(job.delivery_address?.street || '')
    setEditCity(job.delivery_address?.city || '')
    setEditModalOpen(true)
  }

  const resetCreateForm = () => {
    setNewTitle('')
    setNewDesc('')
    setNewPriority(3)
    setNewVehicle('')
    setNewDriver('')
    setNewScheduled('')
    setNewStreet('')
    setNewCity('')
    setFormError('')
  }

  // Filter & Search logic
  const filteredJobs = jobs.filter((job) => {
    const matchesFilter = filter === 'all' || job.status === filter
    const matchesSearch =
      job.title.toLowerCase().includes(search.toLowerCase()) ||
      job.id.toLowerCase().includes(search.toLowerCase()) ||
      (job.delivery_address?.street || '').toLowerCase().includes(search.toLowerCase())

    return matchesFilter && matchesSearch
  })

  const getPriorityBadge = (p: number) => {
    if (p >= 4) {
      return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-100">P{p} (High)</span>
    }
    if (p === 3) {
      return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">P3 (Medium)</span>
    }
    return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">P{p} (Low)</span>
  }

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'assigned':
        return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100 uppercase tracking-wider">Assigned</span>
      case 'in_progress':
        return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100 uppercase tracking-wider">In Progress</span>
      case 'completed':
        return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wider">Completed</span>
      case 'failed':
        return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-100 uppercase tracking-wider">Failed</span>
      default:
        return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-100 uppercase tracking-wider">{s}</span>
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between p-4 gap-4 border-b border-slate-150/60 bg-white select-none shrink-0">
        {/* Status Filters */}
        <div className="bg-slate-100 p-1 border border-slate-200/50 rounded-xl flex gap-1 overflow-x-auto">
          {['all', 'pending', 'assigned', 'in_progress', 'completed', 'failed'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition border-none cursor-pointer ${
                filter === s
                  ? 'bg-white border border-slate-250/20 text-slate-800 shadow-sm font-bold'
                  : 'bg-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <input
            type="text"
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full md:w-64 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-850 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition duration-200"
          />

          <button
            onClick={() => setCreateModalOpen(true)}
            className="shrink-0 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl px-4 py-2.5 flex items-center gap-1.5 shadow-sm transition border-none cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Job
          </button>
        </div>
      </div>

      {/* Scrollable Table Area */}
      <div className="flex-1 overflow-auto min-h-0 bg-white">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm border-b border-slate-200/80 z-10">
            <tr>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/4">Job Detail</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/6">Priority</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/5">Driver</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/5">Vehicle</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/5">Scheduled At</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/6">Status</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-12 text-xs font-medium bg-slate-50/20">
                  No matching jobs found.
                </td>
              </tr>
            ) : (
              filteredJobs.map((job) => {
                const vehicle = vehicles.find((v) => v.id === job.vehicle_id)
                const driver = drivers.find((d) => d.id === job.driver_id)
                return (
                  <tr key={job.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-bold text-slate-900 leading-snug">{job.title}</span>
                        {job.delivery_address && (
                          <span className="text-[10px] text-slate-400 font-medium truncate mt-0.5">
                            📍 {job.delivery_address.street}, {job.delivery_address.city}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">{getPriorityBadge(job.priority)}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {driver ? (
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-slate-800 leading-none">{driver.full_name}</span>
                          <span className="text-[9px] text-slate-400 leading-none mt-1">{driver.email}</span>
                        </div>
                      ) : (
                        <span className="text-xs italic text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {vehicle ? (
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-slate-800 leading-none">{vehicle.registration}</span>
                          <span className="text-[9px] text-slate-400 leading-none mt-1 capitalize">{vehicle.make} {vehicle.model}</span>
                        </div>
                      ) : (
                        <span className="text-xs italic text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {job.scheduled_at ? (
                        <span className="text-xs text-slate-600 font-medium">
                          {(() => {
                            const d = new Date(job.scheduled_at)
                            const yyyy = d.getFullYear()
                            const mm = String(d.getMonth() + 1).padStart(2, '0')
                            const dd = String(d.getDate()).padStart(2, '0')
                            const hh = String(d.getHours()).padStart(2, '0')
                            const min = String(d.getMinutes()).padStart(2, '0')
                            return `${yyyy}-${mm}-${dd} ${hh}:${min}`
                          })()}
                        </span>
                      ) : (
                        <span className="text-xs italic text-slate-400">Not set</span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">{getStatusBadge(job.status)}</td>
                    <td className="px-5 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(job)}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition border border-transparent cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(job.id)}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition border border-transparent cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* CREATE MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-lg font-bold text-slate-950 mb-1">Create Dispatch Job</h3>
            <p className="text-xs text-slate-400 mb-5">Fill in details to release this job to the fleet.</p>

            {formError && (
              <div className="bg-rose-50 border border-rose-100 text-rose-800 text-xs rounded-xl p-3 mb-4 font-semibold">
                ⚠ {formError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Job Title *</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Delivery #1002"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Fragile cargo, deliver with care."
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 h-16 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  >
                    <option value={1}>1 (Low)</option>
                    <option value={2}>2</option>
                    <option value={3}>3 (Medium)</option>
                    <option value={4}>4</option>
                    <option value={5}>5 (High)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Scheduled Date/Time</label>
                  <input
                    type="datetime-local"
                    value={newScheduled}
                    onChange={(e) => setNewScheduled(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Assign Driver</label>
                  <select
                    value={newDriver}
                    onChange={(e) => setNewDriver(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Assign Vehicle</label>
                  <select
                    value={newVehicle}
                    onChange={(e) => setNewVehicle(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Unassigned</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.registration} ({v.make})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Delivery Street</label>
                  <input
                    type="text"
                    value={newStreet}
                    onChange={(e) => setNewStreet(e.target.value)}
                    placeholder="123 High St"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Delivery City</label>
                  <input
                    type="text"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    placeholder="London"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-55 border-none cursor-pointer"
                >
                  {isPending ? 'Saving...' : 'Create Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editModalOpen && editingJob && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-lg font-bold text-slate-950 mb-1">Edit Job Details</h3>
            <p className="text-xs text-slate-400 mb-5">Update scheduling, dispatch routing, or status metadata.</p>

            <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="pending">Pending</option>
                    <option value="assigned">Assigned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Priority</label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  >
                    <option value={1}>1 (Low)</option>
                    <option value={2}>2</option>
                    <option value={3}>3 (Medium)</option>
                    <option value={4}>4</option>
                    <option value={5}>5 (High)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Assign Driver</label>
                  <select
                    value={editDriver}
                    onChange={(e) => setEditDriver(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Assign Vehicle</label>
                  <select
                    value={editVehicle}
                    onChange={(e) => setEditVehicle(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Unassigned</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.registration} ({v.make})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Scheduled Date/Time</label>
                <input
                  type="datetime-local"
                  value={editScheduled}
                  onChange={(e) => setEditScheduled(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Delivery Street</label>
                  <input
                    type="text"
                    value={editStreet}
                    onChange={(e) => setEditStreet(e.target.value)}
                    placeholder="123 High St"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Delivery City</label>
                  <input
                    type="text"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    placeholder="London"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditModalOpen(false)
                    setEditingJob(null)
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-55 border-none cursor-pointer"
                >
                  {isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
