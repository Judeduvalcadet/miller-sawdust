import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Loader2, Link2, Unlink, CheckCircle2, AlertTriangle, Building2, SlidersHorizontal,
  Package, Users, Plus, X, Check, Truck, CalendarDays, Pencil,
} from 'lucide-react';
import { base44 } from '@/api/entities';
import DriverManager from '@/pages/DriverManager';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// V2 Settings — tabbed: Company | Presets | Items | Team | QuickBooks.
// Items is the QuickBooks catalog imported into the app: the same record
// drives the job-form presets, the customer price book, and invoicing.

const TABS = [
  { key: 'company', label: 'Company', icon: Building2 },
  { key: 'presets', label: 'Presets', icon: SlidersHorizontal },
  { key: 'items', label: 'Items', icon: Package },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'quickbooks', label: 'QuickBooks', icon: Link2 },
];

export default function V2Settings() {
  const [tab, setTab] = useState('company');
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-6 pt-5">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <div className="mt-4 flex gap-1 -mb-px overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors',
                tab === key
                  ? 'border-gray-900 text-gray-900 bg-gray-50'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              )}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'company' && <CompanyTab />}
        {tab === 'presets' && <PresetsTab />}
        {tab === 'items' && <ItemsTab />}
        {tab === 'team' && <DriverManager embedded />}
        {tab === 'quickbooks' && <QuickBooksTab />}
      </div>
    </div>
  );
}

/* ------------------------------- Company -------------------------------- */

const COMPANY_FIELDS = [
  { key: 'company_name', label: 'Company name' },
  { key: 'street_address', label: 'Street address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
];

function CompanyTab() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await base44.entities.Settings.list())[0] || null,
  });
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings && form === null) setForm(settings.company_profile || {});
  }, [settings, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (settings?.id) return base44.entities.Settings.update(settings.id, { company_profile: form });
      return base44.entities.Settings.create({ company_profile: form });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (form === null) return <TabLoading />;
  return (
    <div className="p-6 max-w-xl">
      <p className="text-sm text-gray-500 mb-4">
        Company details shown on invoices and statements.
      </p>
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        {COMPANY_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
            <Input
              value={form[key] || ''}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="bg-gray-950 hover:bg-gray-800">
            {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Save
          </Button>
          {saved && <span className="flex items-center gap-1 text-sm text-green-600"><Check className="w-4 h-4" /> Saved</span>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Presets -------------------------------- */

const TRUCK_TYPES = [
  { value: 'straight_truck', label: 'Straight Truck' },
  { value: 'semi', label: 'Semi Truck' },
  { value: 'spreader', label: 'Spreader' },
];

function PresetsTab() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await base44.entities.Settings.list())[0] || null,
  });
  const { data: items } = useQuery({
    queryKey: ['items'],
    queryFn: () => base44.entities.Item.list('sort_order'),
  });
  const [newYard, setNewYard] = useState({});
  const [newInterval, setNewInterval] = useState('');

  // Delivery yardages come from the QuickBooks item catalog — shown here
  // read-only so the presets page reflects what the job form actually offers.
  const itemYards = (truck) => [...new Set(
    (items || [])
      .filter((i) => i.active && i.is_load_item && i.yards != null && (!i.truck_type || i.truck_type === truck))
      .map((i) => Number(i.yards))
  )].sort((a, b) => a - b);

  const update = useMutation({
    mutationFn: async (patch) => {
      if (settings?.id) return base44.entities.Settings.update(settings.id, patch);
      return base44.entities.Settings.create(patch);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (!settings) return <TabLoading />;
  const presets = settings.truck_yard_presets || {};
  const intervals = settings.recurring_interval_presets || [];

  const saveYards = (truck, list) =>
    update.mutate({ truck_yard_presets: { ...presets, [truck]: list } });

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
          <Package className="w-4 h-4 text-gray-500" /> Delivery load yardages
          <span className="text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">from QuickBooks items</span>
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          These are what the job form offers per truck type — derived from the item catalog.
          To change them, edit the items on the Items tab.
        </p>
        <div className="mt-3 space-y-2.5">
          {TRUCK_TYPES.map(({ value, label }) => (
            <div key={value} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
              <div className="flex flex-wrap gap-1.5">
                {itemYards(value).map((y) => (
                  <span key={y} className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-2.5 py-1 text-xs font-medium">{y} yds</span>
                ))}
                {itemYards(value).length === 0 && <span className="text-xs text-gray-400 italic">none yet</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-sm text-gray-500 -mb-1">
        Custom yardage presets — used for pickup jobs and the "Custom" option on loads.
      </p>
      {TRUCK_TYPES.map(({ value, label }) => {
        const yards = presets[value] || [];
        return (
          <div key={value} className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
              <Truck className="w-4 h-4 text-gray-500" /> {label}
            </h3>
            <div className="flex flex-wrap gap-2 mt-3">
              {yards.map((y) => (
                <span key={y} className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-800">
                  {y} yds
                  <button
                    onClick={() => saveYards(value, yards.filter((v) => v !== y))}
                    className="text-gray-400 hover:text-red-500"
                  ><X className="w-3.5 h-3.5" /></button>
                </span>
              ))}
              {yards.length === 0 && <span className="text-sm text-gray-400 italic">No presets yet.</span>}
            </div>
            <div className="flex gap-2 mt-3">
              <Input
                type="number" min="1" step="0.5" placeholder="Add yards…"
                value={newYard[value] || ''}
                onChange={(e) => setNewYard((p) => ({ ...p, [value]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const v = parseFloat(newYard[value]);
                  if (!v || v <= 0 || yards.includes(v)) return;
                  setNewYard((p) => ({ ...p, [value]: '' }));
                  saveYards(value, [...yards, v].sort((a, b) => a - b));
                }}
                className="max-w-[160px]"
              />
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  const v = parseFloat(newYard[value]);
                  if (!v || v <= 0 || yards.includes(v)) return;
                  setNewYard((p) => ({ ...p, [value]: '' }));
                  saveYards(value, [...yards, v].sort((a, b) => a - b));
                }}
              ><Plus className="w-4 h-4" /></Button>
            </div>
          </div>
        );
      })}

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
          <CalendarDays className="w-4 h-4 text-gray-500" /> Recurring job intervals
        </h3>
        <div className="flex flex-wrap gap-2 mt-3">
          {intervals.map((v) => (
            <span key={v} className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-800">
              Every {v} days
              <button
                onClick={() => update.mutate({ recurring_interval_presets: intervals.filter((x) => x !== v) })}
                className="text-gray-400 hover:text-red-500"
              ><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Input
            type="number" min="1" placeholder="Add interval (days)…"
            value={newInterval}
            onChange={(e) => setNewInterval(e.target.value)}
            className="max-w-[180px]"
          />
          <Button
            size="sm" variant="outline"
            onClick={() => {
              const v = parseInt(newInterval);
              if (!v || v <= 0 || intervals.includes(v)) return;
              setNewInterval('');
              update.mutate({ recurring_interval_presets: [...intervals, v].sort((a, b) => a - b) });
            }}
          ><Plus className="w-4 h-4" /></Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Items --------------------------------- */

function ItemsTab() {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useQuery({
    queryKey: ['items'],
    queryFn: () => base44.entities.Item.list('sort_order'),
  });
  const [editing, setEditing] = useState(null); // {id, name, description, unit_price, yards, truck_type}
  const [showInactive, setShowInactive] = useState(false);

  const save = useMutation({
    mutationFn: ({ id, ...patch }) => base44.entities.Item.update(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] }),
  });

  if (isLoading) return <TabLoading />;
  const visible = (items || []).filter((i) => showInactive || i.active);
  const loads = visible.filter((i) => i.is_load_item);
  const others = visible.filter((i) => !i.is_load_item);

  const startEdit = (i) => setEditing({
    id: i.id, name: i.name, description: i.description || '',
    unit_price: i.unit_price ?? '', yards: i.yards ?? '', truck_type: i.truck_type || '',
  });
  const commitEdit = () => {
    if (!editing) return;
    save.mutate({
      id: editing.id,
      name: editing.name.trim(),
      description: editing.description.trim() || null,
      unit_price: editing.unit_price === '' ? null : parseFloat(editing.unit_price),
      yards: editing.yards === '' ? null : parseFloat(editing.yards),
      truck_type: editing.truck_type || null,
    });
    setEditing(null);
  };

  const Row = ({ i }) => (
    <tr className={cn('border-t border-gray-100', !i.active && 'opacity-50')}>
      {editing?.id === i.id ? (
        <>
          <td className="py-2 pl-4 pr-2" colSpan={2}>
            <Input value={editing.name} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} className="h-8 text-sm mb-1.5" />
            <Input value={editing.description} placeholder="Description (shows on invoices)" onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))} className="h-8 text-sm" />
          </td>
          <td className="py-2 px-2">
            <Input type="number" step="0.5" value={editing.yards} placeholder="yds" onChange={(e) => setEditing((p) => ({ ...p, yards: e.target.value }))} className="h-8 text-sm w-20" />
          </td>
          <td className="py-2 px-2">
            <select
              value={editing.truck_type}
              onChange={(e) => setEditing((p) => ({ ...p, truck_type: e.target.value }))}
              className="h-8 text-sm border border-gray-200 rounded-md px-2 bg-white"
            >
              <option value="">Any truck</option>
              {TRUCK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </td>
          <td className="py-2 px-2">
            <Input type="number" step="0.01" value={editing.unit_price} onChange={(e) => setEditing((p) => ({ ...p, unit_price: e.target.value }))} className="h-8 text-sm w-24" />
          </td>
          <td className="py-2 px-2" colSpan={2}>
            <div className="flex gap-1.5">
              <Button size="sm" className="h-8 bg-gray-950 hover:bg-gray-800" onClick={commitEdit}>Save</Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="py-2.5 pl-4 pr-2">
            <p className="font-medium text-gray-900 text-sm">{i.name}</p>
            {i.description && <p className="text-xs text-gray-500 mt-0.5 max-w-md">{i.description}</p>}
          </td>
          <td className="py-2.5 px-2">
            {i.qb_id && <span className="text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 whitespace-nowrap">QB #{i.qb_id}</span>}
          </td>
          <td className="py-2.5 px-2 text-sm text-gray-600 whitespace-nowrap">{i.yards != null ? `${i.yards} yds` : '—'}</td>
          <td className="py-2.5 px-2 text-sm text-gray-600 whitespace-nowrap">
            {TRUCK_TYPES.find((t) => t.value === i.truck_type)?.label || 'Any'}
          </td>
          <td className="py-2.5 px-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
            {i.unit_price != null ? `$${Number(i.unit_price).toLocaleString()}` : '—'}
          </td>
          <td className="py-2.5 px-2">
            <div className="flex items-center gap-1.5" title="Offered as a preset in the job form">
              <Switch
                checked={i.is_load_item}
                onCheckedChange={(v) => save.mutate({ id: i.id, is_load_item: v })}
              />
              <span className="text-[11px] text-gray-400">preset</span>
            </div>
          </td>
          <td className="py-2.5 px-2 pr-4 text-right">
            <button onClick={() => startEdit(i)} className="text-gray-400 hover:text-gray-800 p-1" title="Edit">
              <Pencil className="w-4 h-4" />
            </button>
          </td>
        </>
      )}
    </tr>
  );

  const Table = ({ rows }) => (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-gray-400">
            <th className="py-2.5 pl-4 pr-2 font-medium">Item</th>
            <th className="py-2.5 px-2 font-medium"></th>
            <th className="py-2.5 px-2 font-medium">Yards</th>
            <th className="py-2.5 px-2 font-medium">Truck</th>
            <th className="py-2.5 px-2 font-medium">Price</th>
            <th className="py-2.5 px-2 font-medium">Job form</th>
            <th className="py-2.5 px-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>{rows.map((i) => <Row key={i.id} i={i} />)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-gray-500 max-w-2xl">
          Imported from QuickBooks — one source of truth for pricing across job creation,
          customer price books, and invoices. Edits apply here now and will push back to
          QuickBooks automatically once the write sync is turned on.
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-500 whitespace-nowrap">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} /> Show inactive
        </label>
      </div>
      <div>
        <h3 className="font-semibold text-gray-900 text-sm mb-2">Load presets <span className="text-gray-400 font-normal">— shown when creating a job</span></h3>
        <Table rows={loads} />
      </div>
      <div>
        <h3 className="font-semibold text-gray-900 text-sm mb-2">Other items <span className="text-gray-400 font-normal">— surcharges, hauling, services</span></h3>
        <Table rows={others} />
      </div>
    </div>
  );
}

/* ------------------------------ QuickBooks ------------------------------ */

function QuickBooksTab() {
  const [qb, setQb] = useState({ loading: true });
  const [working, setWorking] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await base44.functions.invoke('qb-auth', { action: 'status' });
      setQb({ loading: false, ...data });
    } catch {
      setQb({ loading: false, error: true });
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const connect = async () => {
    setWorking(true);
    setError('');
    try {
      const { data } = await base44.functions.invoke('qb-auth', { action: 'auth-url' });
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setError("Couldn't start the QuickBooks connection — try again.");
    } catch {
      setError("Couldn't start the QuickBooks connection — try again.");
    }
    setWorking(false);
  };

  const disconnect = async () => {
    setWorking(true);
    try {
      await base44.functions.invoke('qb-auth', { action: 'disconnect' });
      await loadStatus();
    } catch {
      setError("Couldn't disconnect — try again.");
    }
    setWorking(false);
  };

  return (
    <div className="p-6 max-w-2xl">
      <section className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <span className="text-green-700 font-black text-lg">qb</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900">QuickBooks Online</h2>
            <p className="text-sm text-gray-500">Customer, pricing, and invoice sync</p>
          </div>
        </div>

        <div className="mt-4">
          {qb.loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking connection...
            </div>
          ) : qb.connected ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                {qb.tokenExpired ? (
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                )}
                <div className="text-sm">
                  <p className="font-medium text-gray-900">
                    {qb.tokenExpired ? 'Connection expired' : 'Connected'} — {qb.companyName || 'QuickBooks company'}
                  </p>
                  <p className="text-gray-500">
                    {qb.tokenExpired
                      ? 'QuickBooks needs to be reconnected (this happens after ~100 days of inactivity).'
                      : `Connected ${qb.connectedAt ? new Date(qb.connectedAt).toLocaleDateString() : ''}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {qb.tokenExpired && (
                  <Button onClick={connect} disabled={working} className="bg-gray-950 hover:bg-gray-800">
                    {working ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                    Reconnect
                  </Button>
                )}
                <Button variant="outline" onClick={() => setConfirmDisconnect(true)} disabled={working}>
                  <Unlink className="w-4 h-4 mr-2" /> Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Not connected. Connecting requires signing in to Intuit with the account
                that administers the Miller Sawdust QuickBooks company.
              </p>
              <Button onClick={connect} disabled={working} className="bg-gray-950 hover:bg-gray-800">
                {working ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                Connect to QuickBooks
              </Button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </section>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect QuickBooks?</AlertDialogTitle>
            <AlertDialogDescription>
              Syncing stops until it's reconnected. Nothing already in QuickBooks or in this system is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect} className="bg-red-600 hover:bg-red-700">Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TabLoading() {
  return (
    <div className="flex-1 flex items-center justify-center py-24">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );
}
