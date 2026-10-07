'use client'

import { useState, useTransition } from 'react'
import { createUserAction, updateUserAction, deleteUserAction } from '@/app/admin/users/actions'

interface User {
  id: string
  tenant_id: string
  email: string
  role: string
  full_name: string
  is_active: boolean
}

interface UsersManagerProps {
  initialUsers: User[]
  currentUser: {
    id: string | null
    email?: string
    role?: string
  }
}

export default function UsersManager({ initialUsers, currentUser }: UsersManagerProps) {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [isPending, startTransition] = useTransition()

  // Modal States
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)

  // Form State - Create
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newRole, setNewRole] = useState('dispatcher')
  const [formError, setFormError] = useState('')

  // Form State - Edit
  const [editFullName, setEditFullName] = useState('')
  const [editRole, setEditRole] = useState('dispatcher')
  const [editIsActive, setEditIsActive] = useState(true)

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    
    if (!newFullName.trim()) {
      setFormError('Full Name is required')
      return
    }
    if (!newEmail.trim()) {
      setFormError('Email is required')
      return
    }
    if (!newPassword.trim()) {
      setFormError('Password is required')
      return
    }

    startTransition(async () => {
      const res = await createUserAction({
        email: newEmail,
        password: newPassword,
        full_name: newFullName,
        role: newRole,
      })

      if (res.success) {
        setCreateModalOpen(false)
        resetCreateForm()
        window.location.reload()
      } else {
        setFormError(res.error || 'Failed to add team member')
      }
    })
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return

    startTransition(async () => {
      const res = await updateUserAction(editingUser.id, {
        full_name: editFullName,
        role: editRole,
        is_active: editIsActive,
      })

      if (res.success) {
        setEditModalOpen(false)
        setEditingUser(null)
        window.location.reload()
      } else {
        alert(res.error || 'Failed to update user details')
      }
    })
  }

  const handleDelete = async (userId: string) => {
    if (userId === currentUser.id) {
      alert('You cannot delete your own admin account.')
      return
    }

    if (!confirm('Are you sure you want to remove this team member? This action is permanent.')) return

    startTransition(async () => {
      const res = await deleteUserAction(userId)
      if (res.success) {
        window.location.reload()
      } else {
        alert(res.error || 'Failed to remove user')
      }
    })
  }

  const openEditModal = (user: User) => {
    setEditingUser(user)
    setEditFullName(user.full_name)
    setEditRole(user.role)
    setEditIsActive(user.is_active)
    setEditModalOpen(true)
  }

  const resetCreateForm = () => {
    setNewEmail('')
    setNewPassword('')
    setNewFullName('')
    setNewRole('dispatcher')
    setFormError('')
  }

  // Filter & Search logic
  const filteredUsers = users.filter((user) => {
    const matchesFilter = roleFilter === 'all' || user.role === roleFilter
    const matchesSearch =
      user.full_name.toLowerCase().includes(search.toLowerCase()) ||
      user.email.toLowerCase().includes(search.toLowerCase())

    return matchesFilter && matchesSearch
  })

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 uppercase tracking-wider">Admin</span>
      case 'dispatcher':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100 uppercase tracking-wider">Dispatcher</span>
      case 'driver':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-100 uppercase tracking-wider">Driver</span>
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-100 uppercase">{role}</span>
    }
  }

  const getStatusBadge = (isActive: boolean) => {
    return isActive ? (
      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wider">Active</span>
    ) : (
      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-50 text-slate-400 border border-slate-200 uppercase tracking-wider">Inactive</span>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between p-4 gap-4 border-b border-slate-150/60 bg-white select-none shrink-0">
        {/* Role Filters */}
        <div className="bg-slate-100 p-1 border border-slate-200/50 rounded-xl flex gap-1 overflow-x-auto">
          {['all', 'admin', 'dispatcher', 'driver'].map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition border-none cursor-pointer ${
                roleFilter === r
                  ? 'bg-white border border-slate-250/20 text-slate-800 shadow-sm font-bold'
                  : 'bg-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {r === 'all' ? 'All Roles' : r + 's'}
            </button>
          ))}
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <input
            type="text"
            placeholder="Search by name or email..."
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
            Add Member
          </button>
        </div>
      </div>

      {/* Scrollable Table Area */}
      <div className="flex-1 overflow-auto min-h-0 bg-white">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm border-b border-slate-200/80 z-10">
            <tr>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/3">Name</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/4">Email</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/6">Role</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/6">Status</th>
              <th className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-12 text-xs font-medium bg-slate-50/20">
                  No matching team members found.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/50 transition">
                  <td className="px-5 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 font-bold text-xs flex items-center justify-center uppercase">
                        {user.full_name.charAt(0)}
                      </div>
                      <span className="text-sm font-semibold text-slate-900 leading-snug">{user.full_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className="text-xs text-slate-600 font-medium">{user.email}</span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">{getRoleBadge(user.role)}</td>
                  <td className="px-5 py-4 whitespace-nowrap">{getStatusBadge(user.is_active)}</td>
                  <td className="px-5 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditModal(user)}
                        className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition border border-transparent cursor-pointer"
                      >
                        Edit
                      </button>
                      {user.id !== currentUser.id && (
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition border border-transparent cursor-pointer"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* CREATE MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-lg font-bold text-slate-950 mb-1">Add Team Member</h3>
            <p className="text-xs text-slate-400 mb-5">Create credentials for a new administrator, dispatcher, or fleet driver.</p>

            {formError && (
              <div className="bg-rose-50 border border-rose-100 text-rose-800 text-xs rounded-xl p-3 mb-4 font-semibold">
                ⚠ {formError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="janesmith@company.com"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Password *</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Role *</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                >
                  <option value="admin">Administrator</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="driver">Driver</option>
                </select>
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
                  {isPending ? 'Saving...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editModalOpen && editingUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-lg font-bold text-slate-950 mb-1">Edit Team Member</h3>
            <p className="text-xs text-slate-400 mb-5">Modify account settings, de-authorize roles, or toggle active status.</p>

            <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  disabled={editingUser.id === currentUser.id}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 disabled:opacity-55 disabled:cursor-not-allowed"
                >
                  <option value="admin">Administrator</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="driver">Driver</option>
                </select>
                {editingUser.id === currentUser.id && (
                  <p className="text-[10px] text-slate-400 mt-1 italic">You cannot demote your own active admin account.</p>
                )}
              </div>

              <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200/60 rounded-xl mt-1">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-800">Active Account Status</span>
                  <span className="text-[10px] text-slate-400 font-medium">Toggle access privileges for this user.</span>
                </div>
                <input
                  type="checkbox"
                  checked={editIsActive}
                  disabled={editingUser.id === currentUser.id}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="w-5 h-5 accent-indigo-600 rounded cursor-pointer disabled:cursor-not-allowed"
                />
              </div>
              {editingUser.id === currentUser.id && (
                <p className="text-[10px] text-slate-400 italic -mt-2 px-1">You cannot deactivate your own active admin account.</p>
              )}

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditModalOpen(false)
                    setEditingUser(null)
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
