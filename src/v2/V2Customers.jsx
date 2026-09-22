import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, Search, Star, Trash2, Plus, FileText, Check, Pencil, X,
  User, Truck, Receipt, ChevronRight, ImagePlus, MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { base44 } from '@/api/entities';
import { cn } from '@/lib/utils';
import AddressAutocomplete from '@/components/admin/AddressAutocomplete';
import { JobMapPanel, MapThumb, uploadMapImage } from '@/components/admin/CustomerMapSection';
import InvoicePreview from './InvoicePreview';

// V2 Customers — paginated list on the left; on the right the full customer
// file in tabs: Customer information (read-only until Edit), Job history,
// and Invoicing (the imported QuickBooks history with template previews).

const PAGE_SIZES = [25, 50, 100];

export default function V2Customers() {
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  const { data: customers, isLoading } = useQuery({
    queryKey: ['v2-customers'],
    queryFn: () => base44.entities.Customer.list('name', 5000),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers || [];
    if (!q) return list;
    return list.filter((c) =>
      `${c.name || ''} ${c.company_name || ''} ${c.city || ''} ${c.phone || ''}`.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const selected = (customers || []).find((c) => c.id === selectedId) || null;

  return (
    <div className="flex-1 flex min-h-0">
      {/* List */}
      <div className="w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search customers…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-gray-400 px-1">
            <span>{filtered.length} customers</span>
            <span className="flex items-center gap-1.5">
              Show
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-6 w-[60px] px-2 text-xs text-gray-700 rounded-lg border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : pageRows.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={cn(
                'w-full text-left px-4 py-2.5 border-b border-gray-50 hover:bg-gray-50',
                selectedId === c.id && 'bg-gray-100 hover:bg-gray-100'
              )}
            >
              <p className="text-sm font-medium text-gray-900 truncate">{(c.company_name || c.name || '').trim() || '—'}</p>
              <p className="text-xs text-gray-400 truncate">{c.city || c.street_address || ''}</p>
            </button>
          ))}
        </div>
        {totalPages > 1 && (
          <div className="p-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <Button variant="outline" size="sm" className="h-7 px-2" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹ Prev</Button>
            <span>Page {safePage} of {totalPages}</span>
            <Button variant="outline" size="sm" className="h-7 px-2" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next ›</Button>
          </div>
        )}
      </div>

      {/* Detail */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selected ? (
          <CustomerDetail key={selected.id} customer={selected} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 p-10">
            Select a customer to open their file.
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Detail ---------------------------------- */

function CustomerDetail({ customer }) {
  const [tab, setTab] = useState('info');

  const { data: jobs } = useQuery({
    queryKey: ['customer-jobs', customer.id],
    queryFn: async () => {
      const rows = await base44.entities.Job.filter({ customer_id: customer.id }, '-scheduled_date', 2000);
      return rows.filter((j) => !j.deleted_at);
    },
  });
  const { data: invoices } = useQuery({
    queryKey: ['customer-invoices', customer.id],
    queryFn: () => base44.entities.Invoice.filter({ customer_id: customer.id }, '-txn_date', 2000),
  });

  const TABS = [
    { key: 'info', label: 'Customer information', icon: User },
    { key: 'jobs', label: 'Job history', icon: Truck, count: jobs?.length },
    { key: 'invoices', label: 'Invoicing', icon: Receipt, count: invoices?.length },
  ];

  return (
    <div className="flex flex-col min-h-full">
      <div className="px-6 pt-5 bg-white border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-900">{(customer.company_name || customer.name || '').trim()}</h2>
        {customer.company_name && customer.name && customer.name.trim() !== customer.company_name.trim() && (
          <p className="text-sm text-gray-500">{customer.name}</p>
        )}
        <div className="mt-3 flex gap-1 -mb-px overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors',
                tab === key ? 'border-gray-900 text-gray-900 bg-gray-50' : 'border-transparent text-gray-500 hover:text-gray-800'
              )}
            >
              <Icon className="w-4 h-4" /> {label}
              {count != null && (
                <span className="text-[10px] font-semibold bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1">
        {tab === 'info' && <InfoTab customer={customer} />}
        {tab === 'jobs' && <JobsTab jobs={jobs} />}
        {tab === 'invoices' && <InvoicesTab invoices={invoices} customer={customer} />}
      </div>
    </div>
  );
}

/* --------------------------- Info tab ----------------------------------- */

function InfoTab({ customer }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <InfoEdit customer={customer} onDone={() => setEditing(false)} />;

  const address = [customer.street_address, customer.city, [customer.state, customer.zip_code].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

  return (
    <div className="p-6">
      <div className="flex flex-col lg:flex-row gap-6 items-stretch max-w-5xl">
        <div className="flex-1 min-w-0 space-y-5">
          <div className="relative bg-white rounded-2xl border border-gray-200 p-5">
            <Button
              variant="outline" size="sm"
              onClick={() => setEditing(true)}
              className="absolute top-3 right-3 h-7 px-2.5 text-xs"
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
            </Button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Name" value={customer.name} />
              <Field label="Company" value={customer.company_name} />
              <Field label="Phone" value={customer.phone} />
              <Field label="Email" value={customer.email} />
              <div className="sm:col-span-2"><Field label="Address" value={address} /></div>
              <div className="sm:col-span-2"><Field label="Delivery instructions" value={customer.delivery_instructions} pre /></div>
            </div>
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Map / location screenshot</p>
              {customer.map_image_url
                ? <MapThumb src={customer.map_image_url} className="h-32" />
                : <p className="text-sm text-gray-400 italic">None yet</p>}
            </div>
          </div>

          <PriceBook customer={customer} />
        </div>

        {/* Live pinned map */}
        <div className="w-full lg:w-[44%] shrink-0 self-start">
          <div className="h-[300px] lg:h-[52vh] lg:min-h-[380px]">
            <JobMapPanel
              pin={customer.latitude != null ? { lat: customer.latitude, lng: customer.longitude } : null}
              title=""
              waitingText="This customer's address isn't map-verified yet."
              canCapture={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, pre }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      {value
        ? <p className={cn('text-gray-900 mt-0.5', pre && 'whitespace-pre-wrap')}>{value}</p>
        : <p className="text-gray-400 mt-0.5 italic">—</p>}
    </div>
  );
}

function InfoEdit({ customer, onDone }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: customer.name || '',
    company_name: customer.company_name || '',
    phone: customer.phone || '',
    email: customer.email || '',
    street_address: customer.street_address || '',
    city: customer.city || '',
    state: customer.state || '',
    zip_code: customer.zip_code || '',
    delivery_instructions: customer.delivery_instructions || '',
    map_image_url: customer.map_image_url || '',
  });
  const [pendingPin, setPendingPin] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => base44.entities.Customer.update(customer.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v2-customers'] });
      onDone();
    },
  });

  return (
    <div className="p-6">
      <div className="flex flex-col lg:flex-row gap-6 items-stretch max-w-5xl">
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Street address</Label>
              <AddressAutocomplete
                value={form.street_address}
                onChange={(v) => set('street_address', v)}
                onResolve={(place) => {
                  setForm((prev) => ({
                    ...prev,
                    street_address: place.street || prev.street_address,
                    city: place.city || prev.city,
                    state: place.state || prev.state,
                    zip_code: place.zip || prev.zip_code,
                  }));
                  if (place.lat != null) setPendingPin({ lat: place.lat, lng: place.lng });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => set('state', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>ZIP</Label>
                <Input value={form.zip_code} onChange={(e) => set('zip_code', e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Map / location screenshot</Label>
              {form.map_image_url ? (
                <div className="relative inline-block">
                  <MapThumb src={form.map_image_url} className="h-24" />
                  <button
                    type="button"
                    onClick={() => set('map_image_url', '')}
                    className="absolute top-1 right-1 bg-white rounded-full p-0.5 shadow border hover:bg-red-50"
                  >
                    <X className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-400">Use the camera on the map to capture one.</p>
              )}
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Delivery instructions</Label>
              <Textarea
                rows={3}
                value={form.delivery_instructions}
                onChange={(e) => set('delivery_instructions', e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="bg-gray-950 hover:bg-gray-800">
              {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
            </Button>
            <Button variant="outline" onClick={onDone}>Cancel</Button>
          </div>
        </div>

        <div className="w-full lg:w-[44%] shrink-0 self-start">
          <div className="h-[320px] lg:h-[58vh] lg:min-h-[420px]">
            <JobMapPanel
              pin={pendingPin || (customer.latitude != null ? { lat: customer.latitude, lng: customer.longitude } : null)}
              title={[form.company_name || form.name, form.street_address].filter(Boolean).join(' — ')}
              waitingText="Start typing the street address and pick a suggestion — the pin drops here."
              canCapture
              initialInstructions={form.delivery_instructions}
              onSaveImage={async (blob, instructions) => {
                const url = await uploadMapImage(blob);
                set('map_image_url', url);
                if (instructions) set('delivery_instructions', instructions);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Jobs tab ------------------------------------ */

const STATUS_STYLES = {
  completed: 'bg-green-50 text-green-700 border-green-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-gray-50 text-gray-600 border-gray-200',
};

function JobsTab({ jobs }) {
  if (!jobs) return <TabSpinner />;
  if (jobs.length === 0) return <Empty text="No jobs yet for this customer." />;

  const what = (j) => {
    const fromLoads = (j.loads || []).map((l) => l.load_configuration).filter(Boolean);
    return fromLoads.length ? fromLoads.join(', ') : (j.load_configuration || '—');
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2.5 pl-5 pr-2 font-medium">Date</th>
              <th className="py-2.5 px-2 font-medium">What they got</th>
              <th className="py-2.5 px-2 font-medium">Loads</th>
              <th className="py-2.5 px-2 font-medium">Truck</th>
              <th className="py-2.5 px-2 font-medium">Driver</th>
              <th className="py-2.5 px-2 pr-5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-gray-100">
                <td className="py-2.5 pl-5 pr-2 text-sm text-gray-900 whitespace-nowrap">
                  {j.scheduled_date ? new Date(j.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </td>
                <td className="py-2.5 px-2 text-sm text-gray-700">{what(j)}</td>
                <td className="py-2.5 px-2 text-sm text-gray-700 whitespace-nowrap">
                  {j.quantity || 1}{j.delivery_yards ? ` · ${j.delivery_yards} yds` : ''}
                </td>
                <td className="py-2.5 px-2 text-sm text-gray-500 whitespace-nowrap capitalize">{(j.truck_type || '').replace('_', ' ') || '—'}</td>
                <td className="py-2.5 px-2 text-sm text-gray-500 whitespace-nowrap">{j.assigned_driver_name || '—'}</td>
                <td className="py-2.5 px-2 pr-5">
                  <span className={cn('text-[11px] font-medium border rounded-full px-2 py-0.5 capitalize whitespace-nowrap', STATUS_STYLES[j.status] || STATUS_STYLES.pending)}>
                    {(j.status || 'pending').replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------- Invoices tab -------------------------------- */

function InvoicesTab({ invoices, customer }) {
  const [previewInv, setPreviewInv] = useState(null);
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await base44.entities.Settings.list())[0] || null,
  });

  if (!invoices) return <TabSpinner />;
  if (invoices.length === 0) return <Empty text="No invoices for this customer yet." />;

  const money = (v) => v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const summary = (inv) => {
    const names = (inv.lines || []).map((l) => l.name).filter(Boolean);
    return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2.5 pl-5 pr-2 font-medium">Invoice #</th>
              <th className="py-2.5 px-2 font-medium">Date</th>
              <th className="py-2.5 px-2 font-medium">Items</th>
              <th className="py-2.5 px-2 font-medium text-right">Total</th>
              <th className="py-2.5 px-2 font-medium">Status</th>
              <th className="py-2.5 px-2 pr-5"></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                onClick={() => setPreviewInv(inv)}
                className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
              >
                <td className="py-2.5 pl-5 pr-2 text-sm font-medium text-gray-900 whitespace-nowrap">
                  {inv.doc_number || '—'}
                  {inv.source === 'quickbooks' && (
                    <span className="ml-2 text-[9px] font-medium bg-green-50 text-green-700 border border-green-200 rounded px-1 py-0.5 align-middle">QB</span>
                  )}
                </td>
                <td className="py-2.5 px-2 text-sm text-gray-700 whitespace-nowrap">
                  {inv.txn_date ? new Date(inv.txn_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </td>
                <td className="py-2.5 px-2 text-sm text-gray-500">{summary(inv) || '—'}</td>
                <td className="py-2.5 px-2 text-sm font-semibold text-gray-900 text-right whitespace-nowrap">{money(inv.total)}</td>
                <td className="py-2.5 px-2">
                  <span className={cn(
                    'text-[11px] font-medium border rounded-full px-2 py-0.5 whitespace-nowrap',
                    inv.status === 'paid' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                  )}>
                    {inv.status === 'paid' ? 'Paid' : 'Open'}
                  </span>
                </td>
                <td className="py-2.5 px-2 pr-5 text-right"><ChevronRight className="w-4 h-4 text-gray-300 inline" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-2">Click an invoice to preview it.</p>

      <InvoicePreview
        open={!!previewInv}
        onClose={() => setPreviewInv(null)}
        invoice={previewInv}
        customer={customer}
        company={settings?.company_profile}
      />
    </div>
  );
}

/* ----------------------------- Shared ------------------------------------ */

function TabSpinner() {
  return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
}
function Empty({ text }) {
  return <p className="p-8 text-sm text-gray-400 italic">{text}</p>;
}

/* --------------------------- Price book ---------------------------------- */

function PriceBook({ customer }) {
  const queryClient = useQueryClient();
  const { data: items } = useQuery({
    queryKey: ['items'],
    queryFn: () => base44.entities.Item.list('sort_order'),
  });
  const { data: prices, isLoading } = useQuery({
    queryKey: ['customer-prices', customer.id],
    queryFn: () => base44.entities.CustomerItemPrice.filter({ customer_id: customer.id }),
  });

  const [editingRowId, setEditingRowId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [deleteRow, setDeleteRow] = useState(null);
  const [savedRow, setSavedRow] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [addPrice, setAddPrice] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customer-prices', customer.id] });
  const update = useMutation({
    mutationFn: ({ id, ...patch }) => base44.entities.CustomerItemPrice.update(id, patch),
    onSuccess: (_, vars) => { invalidate(); setSavedRow(vars.id); setTimeout(() => setSavedRow(null), 1500); },
  });
  const create = useMutation({
    mutationFn: (row) => base44.entities.CustomerItemPrice.create(row),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id) => base44.entities.CustomerItemPrice.delete(id),
    onSuccess: invalidate,
  });

  const itemById = useMemo(() => new Map((items || []).map((i) => [i.id, i])), [items]);
  const rows = useMemo(() => {
    const list = [...(prices || [])];
    list.sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      const ia = itemById.get(a.item_id), ib = itemById.get(b.item_id);
      return (ia?.sort_order ?? 999) - (ib?.sort_order ?? 999);
    });
    return list;
  }, [prices, itemById]);

  const usedItemIds = new Set(rows.map((r) => r.item_id));
  const addable = (items || []).filter((i) => i.active && !usedItemIds.has(i.id));

  const commitEdit = (row) => {
    const v = parseFloat(editValue);
    setEditingRowId(null);
    if (isNaN(v) || v < 0 || v === Number(row.price)) return;
    update.mutate({ id: row.id, price: v });
  };

  const setDefault = async (row) => {
    const current = rows.find((r) => r.is_default && r.id !== row.id);
    if (current) await base44.entities.CustomerItemPrice.update(current.id, { is_default: false });
    update.mutate({ id: row.id, is_default: true });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 text-sm">Pricing</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          What this customer pays. The starred item is what they usually get. Anything not
          listed here is invoiced at the standard item price.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : (
        <div>
          {rows.length === 0 && (
            <p className="px-5 py-5 text-sm text-gray-400 italic">
              No custom pricing yet — invoices use standard item prices.
            </p>
          )}
          {rows.map((row) => {
            const item = itemById.get(row.item_id);
            const std = item?.unit_price != null ? Number(item.unit_price) : null;
            const differs = std != null && Math.abs(std - Number(row.price)) > 0.004;
            return (
              <div key={row.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-50">
                <button
                  onClick={() => !row.is_default && setDefault(row)}
                  title={row.is_default ? 'Their usual load' : 'Mark as their usual load'}
                  className={cn('shrink-0', row.is_default ? 'text-amber-500' : 'text-gray-200 hover:text-amber-400')}
                >
                  <Star className="w-4 h-4" fill={row.is_default ? 'currentColor' : 'none'} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item?.name || 'Unknown item'}</p>
                  {std != null && (
                    <p className="text-[11px] text-gray-400">
                      standard ${std.toLocaleString()}{differs ? ` — custom for this customer` : ''}
                    </p>
                  )}
                </div>
                {editingRowId === row.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 text-sm">$</span>
                    <Input
                      type="number" step="0.01" autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(row);
                        if (e.key === 'Escape') setEditingRowId(null);
                      }}
                      className="h-8 w-24 text-sm text-right"
                    />
                    <Button size="sm" className="h-8 bg-gray-950 hover:bg-gray-800" onClick={() => commitEdit(row)}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingRowId(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-sm font-semibold tabular-nums', differs ? 'text-amber-700' : 'text-gray-900')}>
                        ${Number(row.price).toLocaleString()}
                      </span>
                      {savedRow === row.id && <Check className="w-4 h-4 text-green-600" />}
                    </div>
                    {/* modal={false}: a modal dropdown + the delete AlertDialog fight
                        over body pointer-events and leave the page unclickable. */}
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button className="text-gray-300 hover:text-gray-700 shrink-0 p-1 rounded hover:bg-gray-100">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditingRowId(row.id); setEditValue(String(row.price)); }}>
                          <Pencil className="w-4 h-4 mr-2" /> Edit price
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteRow(row)} className="text-red-600 focus:text-red-600">
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            );
          })}

          <div className="px-5 py-3">
            {adding ? (
              <div className="flex items-center gap-2">
                <select
                  value={addItemId}
                  onChange={(e) => {
                    setAddItemId(e.target.value);
                    const it = itemById.get(e.target.value);
                    if (it?.unit_price != null) setAddPrice(String(it.unit_price));
                  }}
                  className="h-9 text-sm border border-gray-200 rounded-md px-2 bg-white flex-1 min-w-0"
                >
                  <option value="">Choose an item…</option>
                  {addable.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}{i.unit_price != null ? ` — $${i.unit_price}` : ''}</option>
                  ))}
                </select>
                <span className="text-gray-400 text-sm">$</span>
                <Input type="number" step="0.01" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} className="h-9 w-24 text-sm text-right" />
                <Button
                  size="sm" className="bg-gray-950 hover:bg-gray-800"
                  disabled={!addItemId || addPrice === '' || create.isPending}
                  onClick={() => {
                    create.mutate({
                      customer_id: customer.id,
                      item_id: addItemId,
                      price: parseFloat(addPrice),
                      is_default: rows.length === 0 && !!itemById.get(addItemId)?.is_load_item,
                    });
                    setAdding(false); setAddItemId(''); setAddPrice('');
                  }}
                >Add</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setAddItemId(''); setAddPrice(''); }}>Cancel</Button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
                <Plus className="w-4 h-4" /> Add a custom price
              </button>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => { if (!o) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this price?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRow && `${itemById.get(deleteRow.item_id)?.name || 'This item'} — $${Number(deleteRow.price).toLocaleString()}. `}
              Invoices will fall back to the item's standard price.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteRow) remove.mutate(deleteRow.id); setDeleteRow(null); }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
