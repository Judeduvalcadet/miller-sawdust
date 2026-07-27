import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Input } from "@/components/ui/input";
import { Search, Loader2, Building2, Truck, Factory, MapPinned } from "lucide-react";
import EntityHistoryOverlay from './EntityHistoryOverlay';

// System-wide search: customers, drivers, and locations by name. Selecting a
// result opens the full delivery/pickup history for that entity.
export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState(null); // { type, record }
  const boxRef = useRef(null);

  // close dropdown on outside click
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    // strip characters that break PostgREST or() filter syntax
    const q = query.replace(/[,()%*]/g, ' ').trim();
    if (q.length < 2) {
      setResults(null);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const [cust, driv, pick, drop] = await Promise.all([
          supabase.from('customers').select('id,name,company_name,city,state')
            .or(`name.ilike.*${q}*,company_name.ilike.*${q}*`).order('company_name').limit(8),
          supabase.from('drivers').select('id,name,role')
            .neq('role', 'wallboard').ilike('name', `%${q}%`).order('name').limit(6),
          supabase.from('pickup_locations').select('id,name,address')
            .ilike('name', `%${q}%`).order('name').limit(5),
          supabase.from('drop_off_locations').select('id,name,address')
            .ilike('name', `%${q}%`).order('name').limit(5),
        ]);
        setResults({
          customers: cust.data || [],
          drivers: driv.data || [],
          pickups: pick.data || [],
          dropoffs: drop.data || [],
        });
        setOpen(true);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const pick = (type, record) => {
    setSelection({ type, record });
    setOpen(false);
    setQuery('');
  };

  const total = results
    ? results.customers.length + results.drivers.length + results.pickups.length + results.dropoffs.length
    : 0;

  const Group = ({ title, icon: Icon, items, type, subtitle }) => {
    if (!items.length) return null;
    return (
      <div>
        <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</div>
        {items.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => pick(type, r)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-amber-50"
          >
            <Icon className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm text-gray-900 truncate">
                {type === 'customer' ? (r.company_name || r.name) : r.name}
              </span>
              {subtitle(r) && <span className="block text-xs text-gray-500 truncate">{subtitle(r)}</span>}
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results) setOpen(true); }}
          placeholder="Search customers, drivers, locations..."
          className="pl-9 pr-9"
        />
        {loading && (
          <Loader2 className="w-4 h-4 text-amber-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>

      {open && results && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto pb-2">
          {total === 0 ? (
            <p className="px-3 py-4 text-sm text-gray-500 text-center">No matches in the system.</p>
          ) : (
            <>
              <Group
                title="Customers" icon={Building2} items={results.customers} type="customer"
                subtitle={(r) => [r.company_name && r.name !== r.company_name ? r.name : null, [r.city, r.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
              />
              <Group
                title="Drivers & Staff" icon={Truck} items={results.drivers} type="driver"
                subtitle={(r) => r.role?.replaceAll('_', ' ')}
              />
              <Group
                title="Pickup Locations" icon={Factory} items={results.pickups} type="pickup"
                subtitle={(r) => r.address}
              />
              <Group
                title="Drop-Off Locations" icon={MapPinned} items={results.dropoffs} type="dropoff"
                subtitle={(r) => r.address}
              />
            </>
          )}
        </div>
      )}

      {selection && (
        <EntityHistoryOverlay selection={selection} onClose={() => setSelection(null)} />
      )}
    </div>
  );
}
