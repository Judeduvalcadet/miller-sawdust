import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { Truck, FileText, Users, Map, LogOut, ArrowLeft, Monitor } from 'lucide-react';
import { getTokenClaim, logout } from '@/api/authClient';
import { cn } from '@/lib/utils';
import V2Login from './V2Login';

// V2 shell — a parallel interface over the SAME data. V1 is never touched;
// this whole tree lives under /v2. Office area (invoicing / QuickBooks)
// requires an email+password session (amr='password'), not just an admin PIN.

function useOfficeSession() {
  const role = typeof window !== 'undefined' ? window.localStorage.getItem('miller_driver_role') : '';
  const amr = getTokenClaim('amr');
  return {
    ok: ['admin', 'assistant'].includes(role) && amr === 'password',
    name: typeof window !== 'undefined' ? window.localStorage.getItem('miller_driver_name') : '',
  };
}

function Placeholder({ title, note }) {
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-500">{note}</p>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/v2', end: true, icon: Truck, label: 'Dispatch' },
  { to: '/v2/invoices', icon: FileText, label: 'Invoices' },
  { to: '/v2/customers', icon: Users, label: 'Customers' },
  { to: '/v2/wallboard', icon: Monitor, label: 'Wallboard' },
  { to: '/v2/settings', icon: Map, label: 'Settings' },
];

function V2Shell({ children }) {
  const navigate = useNavigate();
  const { name } = useOfficeSession();
  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-gray-950 text-white flex flex-col">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
          <img src="/logo.jpg" alt="" className="w-9 h-9 rounded-xl object-cover" />
          <div className="min-w-0">
            <p className="font-bold text-sm leading-tight">Miller Sawdust</p>
            <p className="text-[11px] text-gray-400">Version 2</p>
          </div>
        </div>
        <nav className="flex-1 py-3 space-y-0.5 px-2">
          {NAV.map(({ to, end, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                isActive ? 'bg-white/15 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-2 pb-3 space-y-0.5 border-t border-white/10 pt-3">
          <button
            onClick={() => navigate('/AdminDashboard')}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5"
          >
            <ArrowLeft className="w-4 h-4" /> Back to V1
          </button>
          <button
            onClick={async () => { await logout(); navigate('/v2/login'); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5"
          >
            <LogOut className="w-4 h-4" /> Sign out{name ? ` (${name})` : ''}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}

function RequireOffice({ children }) {
  const { ok } = useOfficeSession();
  if (!ok) return <Navigate to="/v2/login" replace />;
  return <V2Shell>{children}</V2Shell>;
}

export default function V2App() {
  return (
    <Routes>
      <Route path="login" element={<V2Login />} />
      <Route path="" element={<RequireOffice><Placeholder title="Dispatch V2" note="The new dispatch layout with the live route map is coming here. Everything reads the same data as V1." /></RequireOffice>} />
      <Route path="invoices" element={<RequireOffice><Placeholder title="Invoices" note="Day-by-day job list with one-click and batch invoice creation, QuickBooks sync, and combined printing — being built next." /></RequireOffice>} />
      <Route path="customers" element={<RequireOffice><Placeholder title="Customers" note="Customer detail overlays with tabs for info, loads, and invoices — with per-customer pricing." /></RequireOffice>} />
      <Route path="wallboard" element={<RequireOffice><Placeholder title="Wallboard V2" note="One row per driver, bigger cards, one day at a time with a day picker." /></RequireOffice>} />
      <Route path="settings" element={<RequireOffice><Placeholder title="Settings" note="QuickBooks connection and office access management will live here." /></RequireOffice>} />
      <Route path="*" element={<Navigate to="/v2" replace />} />
    </Routes>
  );
}
