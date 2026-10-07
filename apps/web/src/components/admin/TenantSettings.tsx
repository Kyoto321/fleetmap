'use client'

import { useState, useTransition } from 'react'
import { updateTenantAction } from '@/app/admin/settings/actions'

interface Tenant {
  id: string
  name: string
  subdomain: string
  plan: string
  branding: {
    primary_color?: string
    logo_url?: string
  }
  is_active: boolean
}

interface TenantSettingsProps {
  tenant: Tenant
}

export default function TenantSettings({ tenant }: TenantSettingsProps) {
  const [name, setName] = useState(tenant.name)
  const [primaryColor, setPrimaryColor] = useState(tenant.branding.primary_color || '#3B82F6')
  const [logoUrl, setLogoUrl] = useState(tenant.branding.logo_url || '')
  
  const [isPending, startTransition] = useTransition()
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')

    if (!name.trim()) {
      setErrorMsg('Organization Name is required')
      return
    }

    startTransition(async () => {
      const res = await updateTenantAction(tenant.id, {
        name,
        branding: {
          primary_color: primaryColor,
          logo_url: logoUrl,
        },
      })

      if (res.success) {
        setSuccessMsg('Branding configurations updated successfully!')
        setTimeout(() => {
          window.location.reload()
        }, 1200)
      } else {
        setErrorMsg(res.error || 'Failed to save settings')
      }
    })
  }

  const copyTenantId = () => {
    navigator.clipboard.writeText(tenant.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'W'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8 w-full">
      {/* Messages */}
      {successMsg && (
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm font-semibold animate-fade-in shadow-sm">
          <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-rose-50 border border-rose-100 text-rose-800 text-sm font-semibold animate-fade-in shadow-sm">
          <svg className="w-5 h-5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3Z" />
          </svg>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Hero Workspace Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-50 to-slate-100/50 p-6 flex flex-col sm:flex-row sm:items-center gap-5 shadow-sm select-none">
        <div 
          className="w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-2xl text-white shadow-md transition-all duration-300 transform hover:scale-105 shrink-0"
          style={{ backgroundColor: primaryColor }}
        >
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="w-full h-full object-cover rounded-2xl" onError={(e) => {
              (e.target as HTMLElement).style.display = 'none'
            }} />
          ) : initials}
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-bold text-slate-900 leading-none">{name || 'Your Workspace'}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="bg-slate-200/70 border border-slate-300/30 px-2.5 py-0.5 rounded-lg font-mono">
              {tenant.subdomain}.localhost
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
            <span className="capitalize">{tenant.plan} Subscription</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-8">
        
        {/* Left Side: Form Inputs */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
              Branding Configuration
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 pl-0.5">
                  Organization Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ACME Logistics"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100 transition duration-200"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 pl-0.5">
                  Brand Accent Color
                </label>
                <div className="flex gap-2.5">
                  <div className="relative w-11 h-11 shrink-0 rounded-xl border border-slate-200 bg-white p-1 shadow-sm flex items-center justify-center">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded-xl"
                    />
                    <div 
                      className="w-full h-full rounded-lg shadow-inner"
                      style={{ backgroundColor: primaryColor }}
                    />
                  </div>
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#3B82F6"
                    pattern="^#[0-9A-Fa-f]{6}$"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100 transition duration-200"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5 pl-0.5">
                Branding Logo Image URL
              </label>
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://company.com/assets/logo.png"
                className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100 transition duration-200"
              />
            </div>
          </div>

          {/* System Properties */}
          <div className="flex flex-col gap-4 mt-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
              System Integration details
            </h3>

            <div className="border border-slate-200/75 rounded-2xl overflow-hidden bg-slate-50/50 shadow-sm p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Workspace ID</span>
                  <span className="text-xs font-mono font-semibold text-slate-700 select-all">{tenant.id}</span>
                </div>
                <button
                  type="button"
                  onClick={copyTenantId}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200 hover:bg-slate-50 text-slate-650 hover:text-slate-800 shadow-sm transition cursor-pointer"
                >
                  {copied ? 'Copied' : 'Copy Key'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">System Domain Prefix</span>
                  <span className="text-xs font-semibold text-slate-800">{tenant.subdomain}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-400 font-semibold">.localhost:3000</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Tenant status</span>
                  <span className="text-xs font-bold text-emerald-600 uppercase flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Active
                  </span>
                </div>
                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">
                  {tenant.plan} plan
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Interactive Branding Preview */}
        <div className="flex flex-col gap-4 select-none shrink-0">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
            Live Preview
          </h3>
          
          <div className="border border-slate-200/80 rounded-2xl shadow-sm bg-slate-50/50 p-4 flex flex-col gap-4.5">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block text-center -mb-2">Sidebar Mockup</span>
            
            {/* Sidebar Mock Header Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-2.5 shadow-sm">
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-white shadow-sm shrink-0"
                style={{ backgroundColor: primaryColor }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="w-full h-full object-cover rounded-lg" onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none'
                  }} />
                ) : name.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                <span className="text-xs font-bold text-slate-900 truncate leading-none">{name || 'Your Company'}</span>
                <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider leading-none">Fleet Management</span>
              </div>
            </div>

            {/* Sidebar Mock active item */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 border border-slate-200/30 text-slate-800">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: primaryColor }} />
                <span>Live Map</span>
              </div>
              <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-450">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-transparent" />
                <span>Jobs List</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Submit Section */}
      <div className="flex justify-end gap-3 border-t border-slate-100 pt-6 mt-4">
        <button
          type="submit"
          disabled={isPending}
          className="text-white font-semibold text-xs rounded-xl px-5 py-3 shadow-md hover:brightness-95 active:scale-[0.98] transition border-none cursor-pointer flex items-center gap-2"
          style={{ backgroundColor: primaryColor }}
        >
          {isPending ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-400 border-t-white animate-spin inline-block" />
              Saving...
            </>
          ) : 'Save Configuration'}
        </button>
      </div>
    </form>
  )
}
