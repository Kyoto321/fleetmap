import { LoginForm } from './LoginForm'

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 text-slate-900 relative overflow-hidden px-4">
      {/* Clean Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-50" />

      {/* Login Card */}
      <div className="w-full max-w-[400px] bg-white border border-slate-200/80 rounded-2xl p-8 shadow-xl shadow-slate-200/50 relative z-10 animate-fade-in">
        {/* Logo and Greeting */}
        <div className="mb-8">
          <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-5 shadow-sm border border-indigo-100/50">
            <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125a1.125 1.125 0 0 0 1.125-1.125V9.75M9 5.25h4.875c.621 0 1.125.504 1.125 1.125v5.25M9 5.25H3.375A1.125 1.125 0 0 0 2.25 6.375v7.875m9.375-9H12m-.002 9h.002m-6.75 0h.008v.008H5.25V12.75Zm3 0h.008v.008H8.25V12.75Zm3 0h.008v.008H11.25V12.75Zm3 0h.008v.008H14.25V12.75Z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 mb-1.5">
            Sign in to FleetOps
          </h1>
          <p className="text-slate-500 text-sm font-normal">
            Enter your credentials to access the dispatcher dashboard.
          </p>
        </div>

        {/* Form component */}
        <LoginForm />

        <p className="mt-8 text-center text-xs text-slate-400 font-normal">
          Having trouble? Ask an admin or{' '}
          <a href="mailto:support@fleetops.io" className="text-indigo-600 hover:text-indigo-500 font-medium transition-colors hover:underline">
            Contact support
          </a>
        </p>
      </div>
    </div>
  )
}
