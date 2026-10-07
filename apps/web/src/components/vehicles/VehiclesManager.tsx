'use client'

import { useState, useTransition } from 'react'
import { createVehicleAction, updateVehicleAction, deleteVehicleAction } from '@/app/(dashboard)/vehicles/actions'

interface Vehicle {
  id: string
  tenant_id: string
  registration: string
  make: string | null
  model: string | null
  year: number | null
  status: string
  assigned_driver_id: string | null
  last_position?: {
    latitude: number
    longitude: number
  } | null
}

interface Driver {
  id: string
  full_name: string
  email: string
}

interface VehiclesManagerProps {
  initialVehicles: Vehicle[]
  drivers: Driver[]
}

export default function VehiclesManager({ initialVehicles, drivers }: VehiclesManagerProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicles)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [isPending, startTransition] = useTransition()

  // Modal States
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)

  // Form State - Create
  const [newReg, setNewReg] = useState('')
  const [newMake, setNewMake] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newYear, setNewYear] = useState(new Date().getFullYear())
  const [formError, setFormError] = useState('')

  // Form State - Edit
  const [editStatus, setEditStatus] = useState('idle')
  const [editDriverId, setEditDriverId] = useState<string>('')

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (!newReg.trim()) {
      setFormError('Registration plate is required')
      return
    }

    startTransition(async () => {
      const res = await createVehicleAction({
        registration: newReg,
        make: newMake || undefined,
        model: newModel || undefined,
        year: newYear || undefined,
      })

      if (res.success) {
        setCreateModalOpen(false)
        resetCreateForm()
        window.location.reload()
      } else {
        setFormError(res.error || 'Failed to add vehicle')
      }
    })
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingVehicle) return

    startTransition(async () => {
      const res = await updateVehicleAction(editingVehicle.id, {
        status: editStatus,
        assigned_driver_id: editDriverId || null,
      })

      if (res.success) {
        setEditModalOpen(false)
        setEditingVehicle(null)
        window.location.reload()
      } else {
        alert(res.error || 'Failed to update vehicle')
      }
    })
  }

  const handleDelete = async (vehicleId: string) => {
    if (!confirm('Are you sure you want to remove this vehicle from the fleet?')) return

    startTransition(async () => {
      const res = await deleteVehicleAction(vehicleId)
      if (res.success) {
        window.location.reload()
      } else {
        alert(res.error || 'Failed to remove vehicle')
      }
    })
  }

  const openEditModal = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle)
    setEditStatus(vehicle.status)
    setEditDriverId(vehicle.assigned_driver_id || '')
    setEditModalOpen(true)
  }

  const resetCreateForm = () => {
    setNewReg('')
    setNewMake('')
    setNewModel('')
    setNewYear(new Date().getFullYear())
    setFormError('')
  }

  // Filter & Search logic
  const filteredVehicles = vehicles.filter((v) => {
    const matchesFilter = statusFilter === 'all' || v.status === statusFilter
    const matchesSearch =
      v.registration.toLowerCase().includes(search.toLowerCase()) ||
      (v.make && v.make.toLowerCase().includes(search.toLowerCase())) ||
      (v.model && v.model.toLowerCase().includes(search.toLowerCase()))

    return matchesFilter && matchesSearch
  })

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'idle':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wider">Idle</span>
      case 'en_route':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100 uppercase tracking-wider">En Route</span>
      case 'maintenance':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100 uppercase tracking-wider">Maintenance</span>
      case 'offline':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 uppercase tracking-wider">Offline</span>
      default:
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-50 text-slate-650 border border-slate-200 uppercase">{status}</span>
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between p-4 gap-4 border-b border-slate-150/60 bg-white select-none shrink-0">
        {/* Status Filters */}
        <div className="bg-slate-100 p-1 border border-slate-200/50 rounded-xl flex gap-1 overflow-x-auto">
          {['all', 'idle', 'en_route', 'maintenance', 'offline'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition border-none cursor-pointer ${
                statusFilter === s
                  ? 'bg-white border border-slate-250/20 text-slate-800 shadow-sm font-bold'
                  : 'bg-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {s === 'all' ? 'All Statuses' : s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <input
            type="text"
            placeholder="Search by registration, make..."
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
            Add Vehicle
          </button>
        </div>
      </div>

      {/* Scrollable Table Area */}
      <div className="flex-1 overflow-auto min-h-0 bg-white">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm border-b border-slate-200/80 z-10">
            <tr>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/4">Registration</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/4">Specs</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/5">Assigned Driver</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/6">Status</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/6">GPS Position</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/12 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredVehicles.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 py-12 text-xs font-medium bg-slate-50/20">
                  No matching vehicles found.
                </td>
              </tr>
            ) : (
              filteredVehicles.map((vehicle) => {
                const driverObj = drivers.find((d) => d.id === vehicle.assigned_driver_id)
                return (
                  <tr key={vehicle.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-6 rounded bg-slate-100 border border-slate-350 text-slate-700 font-mono font-bold text-xs flex items-center justify-center tracking-tight shadow-sm select-none uppercase">
                          {vehicle.registration}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-800">
                          {vehicle.make || 'Unknown'} {vehicle.model || ''}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">Year: {vehicle.year || 'N/A'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {driverObj ? (
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-slate-800">{driverObj.full_name}</span>
                          <span className="text-[10px] text-slate-400">{driverObj.email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">{getStatusBadge(vehicle.status)}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {vehicle.last_position ? (
                        <span className="text-xs text-slate-600 font-mono font-medium">
                          {vehicle.last_position.latitude.toFixed(4)}, {vehicle.last_position.longitude.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium italic">No GPS Lock</span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(vehicle)}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition border border-transparent cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(vehicle.id)}
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
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-lg font-bold text-slate-950 mb-1">Add Fleet Vehicle</h3>
            <p className="text-xs text-slate-400 mb-5">Register a new physical vehicle to the multi-tenant control plane.</p>

            {formError && (
              <div className="bg-rose-50 border border-rose-100 text-rose-800 text-xs rounded-xl p-3 mb-4 font-semibold">
                ⚠ {formError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Registration Plate *</label>
                <input
                  type="text"
                  required
                  value={newReg}
                  onChange={(e) => setNewReg(e.target.value)}
                  placeholder="AB12 CDE"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Make</label>
                <input
                  type="text"
                  value={newMake}
                  onChange={(e) => setNewMake(e.target.value)}
                  placeholder="Ford"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Model</label>
                <input
                  type="text"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder="Transit"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Year</label>
                <input
                  type="number"
                  value={newYear}
                  onChange={(e) => setNewYear(parseInt(e.target.value, 10))}
                  placeholder="2022"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
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
                  {isPending ? 'Saving...' : 'Add Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editModalOpen && editingVehicle && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-lg font-bold text-slate-950 mb-1">Edit Vehicle Settings</h3>
            <p className="text-xs text-slate-400 mb-5">Modify dispatcher assignment and real-time status.</p>

            <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Registration</label>
                <input
                  type="text"
                  disabled
                  value={editingVehicle.registration}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-500 cursor-not-allowed select-none uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                >
                  <option value="idle">Idle</option>
                  <option value="en_route">En Route</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="offline">Offline</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Assigned Driver</label>
                <select
                  value={editDriverId}
                  onChange={(e) => setEditDriverId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Unassigned</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} ({d.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditModalOpen(false)
                    setEditingVehicle(null)
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
