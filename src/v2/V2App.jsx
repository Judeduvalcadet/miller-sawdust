import { useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Truck, FileText, Users, Map, LogOut, ArrowLeft, Monitor, BookUser, Factory, MapPin, ChevronDown } from 'lucide-react';
import { getTokenClaim, logout } from '@/api/authClient';
import { cn } from '@/lib/utils';
import V2Login from './V2Login';
import V2Settings from './V2Settings';
import V2Customers from './V2Customers';
import { V2Pickups, V2Dropoffs } from './V2Directory';
import V2Invoices from './V2Invoices';

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

const NAV_TOP = [
  { to: '/v2', end: true, icon: Truck, label: 'Dispatch' },
  { to: '/v2/invoices', icon: FileText, label: 'Invoices' },
];
// The Directory: everyone the business deals with — customers we sell to,
// suppliers we buy sawdust from, and drop-off points. Expands on hover.
const DIRECTORY = [
  { to: '/v2/customers', icon: Users, label: 'Customers' },
  { to: '/v2/pickups', icon: Factory, label: 'Pickup Locations' },
  { to: '/v2/dropoffs', icon: MapPin, label: 'Drop-off Locations' },
];
const NAV_BOTTOM = [
  { to: '/v2/wallboard', icon: Monitor, label: 'Wallboard' },
  { to: '/v2/settings', icon: Map, label: 'Settings' },
];

function navLinkClass({ isActive }) {
  return cn(
    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
    isActive ? 'bg-white/15 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
  );
}

function DirectoryGroup() {
  const location = useLocation();
  const [hovered, setHovered] = useState(false);
  const routeInside = DIRECTORY.some((d) => location.pathname.startsWith(d.to));
  const open = hovered || routeInside;
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-default transition-colors',
        routeInside ? 'text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
      )}>
        <BookUser className="w-4 h-4 shrink-0" /> Directory
        <ChevronDown className={cn('w-3.5 h-3.5 ml-auto transition-transform', open && 'rotate-180')} />
      </div>
      <div className={cn('overflow-hidden transition-all', open ? 'max-h-40' : 'max-h-0')}>
        {DIRECTORY.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              'flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-[13px] transition-colors',
              isActive ? 'bg-white/15 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" /> {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function V2Shell({ children }) {
  const navigate = useNavigate();
  const { name } = useOfficeSession();
  return (
    <div className="h-screen overflow-hidden bg-gray-100 flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-gray-950 text-white flex flex-col">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
          <img src="/logo.jpg" alt="" className="w-9 h-9 rounded-xl object-cover" />
          <div className="min-w-0">
            <p className="font-bold text-sm leading-tight">Miller Sawdust</p>
            <p className="text-[11px] text-gray-400">Version 2</p>
            {import.meta.env.MODE === 'sandbox' && (
              <span className="inline-block mt-1 text-[10px] font-bold tracking-wide bg-amber-500 text-gray-950 rounded px-1.5 py-0.5">
                SANDBOX — local data
              </span>
            )}
          </div>
        </div>
        <nav className="flex-1 py-3 space-y-0.5 px-2">
          {NAV_TOP.map(({ to, end, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass}>
              <Icon className="w-4 h-4 shrink-0" /> {label}
            </NavLink>
          ))}
          <DirectoryGroup />
          {NAV_BOTTOM.map(({ to, end, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass}>
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
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</main>
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
      <Route path="invoices" element={<RequireOffice><V2Invoices /></RequireOffice>} />
      <Route path="customers" element={<RequireOffice><V2Customers /></RequireOffice>} />
      <Route path="pickups" element={<RequireOffice><V2Pickups /></RequireOffice>} />
      <Route path="dropoffs" element={<RequireOffice><V2Dropoffs /></RequireOffice>} />
      <Route path="wallboard" element={<RequireOffice><Placeholder title="Wallboard V2" note="One row per driver, bigger cards, one day at a time with a day picker." /></RequireOffice>} />
      <Route path="settings" element={<RequireOffice><V2Settings /></RequireOffice>} />
      <Route path="*" element={<Navigate to="/v2" replace />} />
    </Routes>
  );
}
