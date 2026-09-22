import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, Search, Plus, ChevronLeft, ChevronRight, MoreVertical, Printer,
  Eye, Check, X, CalendarDays, Receipt, StickyNote, CircleDollarSign, Trash2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { base44 } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { cn } from '@/lib/utils';
import InvoicePreview, { InvoiceTemplate } from './InvoicePreview';

// V2 Invoices — two views:
//  - "All invoices": everything in the system (QuickBooks import + app-created)
//    with status/date/customer filters, previews, print-to-send, notes.
//  - "Create": a week strip of days; the delivery jobs of the picked day
//    (pickups are never invoiceable) with single-job creation or the batch
//    wizard (adjust → Next → … → Done). Lines come from the job's items at
//    the customer's price, falling back to the standard item price.

const money = (v) => v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const iso = (d) => d.toISOString().slice(0, 10);

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return iso(d);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
}

export default function V2Invoices() {
  const [view, setView] = useState('list'); // 'list' | 'create'
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-white border-b border-gray-200 px-6 pt-5 pb-0 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
          <div className="mt-3 flex gap-1 -mb-px">
            {[['list', 'All invoices', Receipt], ['create', 'Create', Plus]].map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors',
                  view === key ? 'border-gray-900 text-gray-900 bg-gray-50' : 'border-transparent text-gray-500 hover:text-gray-800'
                )}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === 'list' ? <InvoiceList /> : <CreateView onCreated={() => {}} />}
      </div>
    </div>
  );
}

/* ============================== LIST VIEW =============================== */

const PAGE_SIZES = [25, 50, 100];

function InvoiceList() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [previewInv, setPreviewInv] = useState(null);
  const [noteInv, setNoteInv] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [checked, setChecked] = useState(new Set());
  const [printQueue, setPrintQueue] = useState(null);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['v2-invoices'],
    queryFn: () => base44.entities.Invoice.list('-txn_date', 10000),
  });
  const { data: customers } = useQuery({
    queryKey: ['v2-customers'],
    queryFn: () => base44.entities.Customer.list('name', 5000),
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await base44.entities.Settings.list())[0] || null,
  });
  const custById = useMemo(() => new Map((customers || []).map((c) => [c.id, c])), [customers]);
  const custName = (inv) => {
    const c = custById.get(inv.customer_id);
    return c ? (c.company_name || c.name || '').trim() : '(not matched)';
  };

  const update = useMutation({
    mutationFn: ({ id, ...patch }) => base44.entities.Invoice.update(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2-invoices'] }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (invoices || []).filter((inv) => {
      if (status !== 'all' && inv.status !== status) return false;
      if (from && (inv.txn_date || '') < from) return false;
      if (to && (inv.txn_date || '') > to) return false;
      if (q) {
        const hay = `${custName(inv)} ${inv.doc_number || ''} ${inv.note || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, search, status, from, to, custById]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggle = (id) => setChecked((p) => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const checkedRows = filtered.filter((i) => checked.has(i.id));

  const markSent = (list) => {
    const now = new Date().toISOString();
    list.forEach((inv) => update.mutate({ id: inv.id, sent_at: now }));
  };

  const summary = (inv) => {
    const names = (inv.lines || []).map((l) => l.name).filter(Boolean);
    return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
  };

  return (
    <div className="p-6 max-w-6xl flex flex-col min-h-0" style={{ height: '100%' }}>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search customer, invoice #…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 w-64 bg-white"
          />
        </div>
        <div className="flex gap-1 bg-gray-200/60 rounded-lg p-0.5">
          {[['all', 'All'], ['open', 'Open'], ['paid', 'Paid']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => { setStatus(v); setPage(1); }}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                status === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              )}
            >{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-9 w-[140px] bg-white text-xs" />
          <span>to</span>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-9 w-[140px] bg-white text-xs" />
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo(''); }} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          )}
        </div>
        <span className="ml-auto text-[11px] text-gray-400">{filtered.length.toLocaleString()} invoices</span>
      </div>

      {/* Bulk bar */}
      {checked.size > 0 && (
        <div className="mb-2 flex items-center gap-3 bg-gray-950 text-white rounded-xl px-4 py-2 text-sm">
          <span>{checked.size} selected</span>
          <Button
            size="sm" variant="secondary" className="h-7 text-xs"
            onClick={() => setPrintQueue(checkedRows)}
          >
            <Printer className="w-3.5 h-3.5 mr-1.5" /> Send (print all)
          </Button>
          <button onClick={() => setChecked(new Set())} className="ml-auto text-gray-400 hover:text-white text-xs">Clear</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-auto flex-1 min-h-0">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#f3f4f6]">
              <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-2.5 pl-4 pr-1 w-8"></th>
                <th className="py-2.5 px-2 font-medium">Invoice #</th>
                <th className="py-2.5 px-2 font-medium">Date</th>
                <th className="py-2.5 px-2 font-medium">Customer</th>
                <th className="py-2.5 px-2 font-medium">Items</th>
                <th className="py-2.5 px-2 font-medium text-right">Total</th>
                <th className="py-2.5 px-2 font-medium">Status</th>
                <th className="py-2.5 px-2 pr-4 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pl-4 pr-1">
                    <input
                      type="checkbox"
                      checked={checked.has(inv.id)}
                      onChange={() => toggle(inv.id)}
                      className="accent-gray-900 w-3.5 h-3.5"
                    />
                  </td>
                  <td className="py-2 px-2 text-sm font-medium text-gray-900 whitespace-nowrap cursor-pointer" onClick={() => setPreviewInv(inv)}>
                    {inv.doc_number || '—'}
                    {inv.source === 'quickbooks' && (
                      <span className="ml-1.5 text-[9px] font-medium bg-green-50 text-green-700 border border-green-200 rounded px-1 py-0.5 align-middle">QB</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-sm text-gray-700 whitespace-nowrap">{fmtDate(inv.txn_date)}</td>
                  <td className="py-2 px-2 text-sm text-gray-900 max-w-[200px] truncate">{custName(inv)}</td>
                  <td className="py-2 px-2 text-sm text-gray-500 max-w-[260px] truncate">
                    {summary(inv) || '—'}
                    {inv.note && <span className="ml-1.5 text-[10px] text-amber-600" title={inv.note}>📝</span>}
                  </td>
                  <td className="py-2 px-2 text-sm font-semibold text-gray-900 text-right whitespace-nowrap">{money(inv.total)}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'text-[11px] font-medium border rounded-full px-2 py-0.5 whitespace-nowrap',
                        inv.status === 'paid' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                      )}>
                        {inv.status === 'paid' ? 'Paid' : 'Open'}
                      </span>
                      {inv.sent_at && <span className="text-[10px] text-gray-400 whitespace-nowrap" title={`Sent ${new Date(inv.sent_at).toLocaleString()}`}>sent</span>}
                    </div>
                  </td>
                  <td className="py-2 px-2 pr-4 text-right">
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button className="text-gray-300 hover:text-gray-700 p-1 rounded hover:bg-gray-100">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setPreviewInv(inv)}>
                          <Eye className="w-4 h-4 mr-2" /> Preview
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPrintQueue([inv])}>
                          <Printer className="w-4 h-4 mr-2" /> Send (print)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => update.mutate(
                          inv.status === 'paid'
                            ? { id: inv.id, status: 'open', balance: inv.total }
                            : { id: inv.id, status: 'paid', balance: 0 }
                        )}>
                          <CircleDollarSign className="w-4 h-4 mr-2" /> Mark as {inv.status === 'paid' ? 'open' : 'paid'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setNoteInv(inv); setNoteText(inv.note || ''); }}>
                          <StickyNote className="w-4 h-4 mr-2" /> {inv.note ? 'Edit note' : 'Add note'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-gray-400 italic">No invoices match.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer pager */}
      <div className="pt-2 flex items-center justify-between text-xs text-gray-500">
        <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
          Show
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-6 w-[58px] px-2 text-xs text-gray-700 rounded-lg border-gray-200 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </span>
        <span className="flex items-center gap-0.5">
          <button onClick={() => setPage(safePage - 1)} disabled={safePage <= 1} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30" aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
          <span className="tabular-nums text-[11px] px-0.5">{safePage} / {totalPages}</span>
          <button onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30" aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
        </span>
      </div>

      <InvoicePreview
        open={!!previewInv}
        onClose={() => setPreviewInv(null)}
        invoice={previewInv}
        customer={previewInv ? custById.get(previewInv.customer_id) : null}
        company={settings?.company_profile}
      />

      {/* Note dialog */}
      <Dialog open={!!noteInv} onOpenChange={(o) => { if (!o) setNoteInv(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Invoice note</DialogTitle></DialogHeader>
          <Textarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. picked up by John, leave at the barn…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteInv(null)}>Cancel</Button>
            <Button
              className="bg-gray-950 hover:bg-gray-800"
              onClick={() => { update.mutate({ id: noteInv.id, note: noteText.trim() || null }); setNoteInv(null); }}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {printQueue && (
        <PrintInvoices
          invoices={printQueue}
          custById={custById}
          company={settings?.company_profile}
          onDone={(printed) => { if (printed) markSent(printQueue); setPrintQueue(null); setChecked(new Set()); }}
        />
      )}
    </div>
  );
}

/* ============================= CREATE VIEW ============================== */

function CreateView() {
  const queryClient = useQueryClient();
  const today = iso(new Date());
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [day, setDay] = useState(today);
  const [checked, setChecked] = useState(new Set());
  const [openJobId, setOpenJobId] = useState(null);   // single-job composer
  const [batch, setBatch] = useState(null);           // { ids: [], index }

  const weekDays = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)); // Mon–Sat
  const weekEnd = addDays(weekStart, 6);

  const { data: weekJobs, isLoading } = useQuery({
    queryKey: ['inv-week-jobs', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase.from('jobs').select('*')
        .eq('job_type', 'delivery').is('deleted_at', null)
        .gte('scheduled_date', weekStart).lte('scheduled_date', weekEnd)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
  const { data: weekInvoices } = useQuery({
    queryKey: ['inv-week-invoices', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('*')
        .not('job_id', 'is', null)
        .gte('txn_date', weekStart).lte('txn_date', weekEnd);
      if (error) throw error;
      return data;
    },
  });
  const { data: customers } = useQuery({
    queryKey: ['v2-customers'],
    queryFn: () => base44.entities.Customer.list('name', 5000),
  });
  const { data: items } = useQuery({
    queryKey: ['items'],
    queryFn: () => base44.entities.Item.list('sort_order'),
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await base44.entities.Settings.list())[0] || null,
  });

  const custById = useMemo(() => new Map((customers || []).map((c) => [c.id, c])), [customers]);
  const invByJob = useMemo(() => new Map((weekInvoices || []).map((i) => [i.job_id, i])), [weekInvoices]);
  const dayJobs = (weekJobs || []).filter((j) => j.scheduled_date === day);
  const countFor = (d) => (weekJobs || []).filter((j) => j.scheduled_date === d).length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['inv-week-invoices', weekStart] });
    queryClient.invalidateQueries({ queryKey: ['v2-invoices'] });
  };

  const uninvoicedChecked = [...checked].filter((id) => !invByJob.has(id));

  const startBatch = () => {
    const ids = dayJobs.filter((j) => checked.has(j.id) && !invByJob.has(j.id)).map((j) => j.id);
    if (ids.length === 0) return;
    setOpenJobId(null);
    setBatch({ ids, index: 0 });
  };

  const jobLabel = (j) => {
    const c = custById.get(j.customer_id);
    return (c?.company_name || c?.name || j.location_name || '').trim();
  };

  return (
    <div className="p-6 max-w-4xl">
      {/* Week strip */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => { const w = addDays(weekStart, -7); setWeekStart(w); setDay(w); setChecked(new Set()); }} className="p-1.5 rounded-lg hover:bg-gray-200" aria-label="Previous week">
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>
        <div className="flex gap-1.5 flex-1">
          {weekDays.map((d) => {
            const dt = new Date(d + 'T00:00:00');
            return (
              <button
                key={d}
                onClick={() => { setDay(d); setChecked(new Set()); setOpenJobId(null); setBatch(null); }}
                className={cn(
                  'flex-1 rounded-xl border px-2 py-2 text-center transition-colors',
                  day === d ? 'bg-gray-950 text-white border-gray-950' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                )}
              >
                <p className="text-[10px] uppercase tracking-wide opacity-70">{dt.toLocaleDateString('en-US', { weekday: 'short' })}</p>
                <p className="text-sm font-semibold">{fmtDay(d)}</p>
                <p className={cn('text-[10px]', day === d ? 'text-gray-300' : 'text-gray-400')}>{countFor(d)} jobs</p>
              </button>
            );
          })}
        </div>
        <button onClick={() => { const w = addDays(weekStart, 7); setWeekStart(w); setDay(w); setChecked(new Set()); }} className="p-1.5 rounded-lg hover:bg-gray-200" aria-label="Next week">
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
        <label className="relative p-1.5 rounded-lg hover:bg-gray-200 cursor-pointer" title="Jump to a date">
          <CalendarDays className="w-4 h-4 text-gray-500" />
          <input
            type="date"
            value={day}
            onChange={(e) => {
              if (!e.target.value) return;
              setWeekStart(mondayOf(e.target.value));
              setDay(e.target.value);
              setChecked(new Set());
            }}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
      </div>

      {/* Batch bar */}
      {checked.size > 0 && !batch && (
        <div className="mb-3 flex items-center gap-3 bg-gray-950 text-white rounded-xl px-4 py-2 text-sm">
          <span>{checked.size} selected{uninvoicedChecked.length !== checked.size ? ` (${checked.size - uninvoicedChecked.length} already invoiced)` : ''}</span>
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={startBatch} disabled={uninvoicedChecked.length === 0}>
            Create {uninvoicedChecked.length} invoice{uninvoicedChecked.length !== 1 ? 's' : ''}
          </Button>
          <button onClick={() => setChecked(new Set())} className="ml-auto text-gray-400 hover:text-white text-xs">Clear</button>
        </div>
      )}

      {/* Batch progress */}
      {batch && (
        <div className="mb-3 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-800">
          <span>Batch: invoice {Math.min(batch.index + 1, batch.ids.length)} of {batch.ids.length}</span>
          <button onClick={() => setBatch(null)} className="ml-auto text-amber-500 hover:text-amber-800 text-xs">Stop</button>
        </div>
      )}

      {/* Day jobs */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : dayJobs.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-8">No delivery jobs on {fmtDate(day)}.</p>
      ) : (
        <div className="space-y-2">
          {dayJobs.map((job) => {
            const inv = invByJob.get(job.id);
            const isBatchCurrent = batch && batch.ids[batch.index] === job.id;
            const composerOpen = isBatchCurrent || openJobId === job.id;
            return (
              <div key={job.id} className={cn('bg-white rounded-2xl border', composerOpen ? 'border-gray-400 shadow-sm' : 'border-gray-200')}>
                <div className="flex items-center gap-3 px-4 py-3">
                  {!inv && (
                    <input
                      type="checkbox"
                      checked={checked.has(job.id)}
                      onChange={() => setChecked((p) => { const n = new Set(p); n.has(job.id) ? n.delete(job.id) : n.add(job.id); return n; })}
                      className="accent-gray-900 w-4 h-4 shrink-0"
                      disabled={!!batch}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{jobLabel(job)}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {(job.loads || []).map((l) => l.load_configuration).filter(Boolean).join(', ') || job.load_configuration || '—'}
                      {' · '}{job.quantity || 1} load{(job.quantity || 1) !== 1 ? 's' : ''}
                      {job.assigned_driver_name ? ` · ${job.assigned_driver_name}` : ''}
                    </p>
                  </div>
                  {inv ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-medium bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
                        Invoice #{inv.doc_number}{inv.sent_at ? ' · sent' : ''}
                      </span>
                    </div>
                  ) : !batch && (
                    <Button
                      size="sm" variant={composerOpen ? 'outline' : 'default'}
                      className={cn('h-7 text-xs shrink-0', !composerOpen && 'bg-gray-950 hover:bg-gray-800')}
                      onClick={() => setOpenJobId(composerOpen ? null : job.id)}
                    >
                      {composerOpen ? 'Close' : 'Create invoice'}
                    </Button>
                  )}
                </div>
                {composerOpen && customers && items && (
                  <InvoiceComposer
                    key={job.id}
                    job={job}
                    customer={custById.get(job.customer_id)}
                    items={items}
                    isBatch={!!isBatchCurrent}
                    batchInfo={isBatchCurrent ? { index: batch.index, count: batch.ids.length } : null}
                    onCancel={() => { setOpenJobId(null); setBatch(null); }}
                    onCreated={() => {
                      refresh();
                      if (isBatchCurrent) {
                        if (batch.index + 1 >= batch.ids.length) { setBatch(null); setChecked(new Set()); }
                        else setBatch({ ...batch, index: batch.index + 1 });
                      } else {
                        setOpenJobId(null);
                      }
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {!settings && null}
    </div>
  );
}

/* ---------------------------- Composer ---------------------------------- */

function InvoiceComposer({ job, customer, items, isBatch, batchInfo, onCancel, onCreated }) {
  const { data: prices } = useQuery({
    queryKey: ['customer-prices', job.customer_id],
    queryFn: () => base44.entities.CustomerItemPrice.filter({ customer_id: job.customer_id }),
    enabled: !!job.customer_id,
  });

  const itemById = useMemo(() => new Map((items || []).map((i) => [i.id, i])), [items]);
  const priceFor = (itemId) => {
    const row = (prices || []).find((p) => p.item_id === itemId);
    if (row) return Number(row.price);
    const it = itemById.get(itemId);
    return it?.unit_price != null ? Number(it.unit_price) : 0;
  };

  const [lines, setLines] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addingItem, setAddingItem] = useState('');

  // Build default lines from the job's loads once prices are known.
  useEffect(() => {
    if (lines !== null || (job.customer_id && prices === undefined)) return;
    const loads = (job.loads || []).length
      ? job.loads
      : [{ item_id: job.item_id, load_configuration: job.load_configuration }];
    const groups = new Map();
    for (const l of loads) {
      const key = l.item_id || `custom:${l.load_configuration || 'Load'}`;
      const g = groups.get(key) || { item_id: l.item_id || null, label: l.load_configuration || '', qty: 0 };
      g.qty += 1;
      groups.set(key, g);
    }
    const out = [];
    for (const g of groups.values()) {
      if (g.item_id && itemById.has(g.item_id)) {
        const it = itemById.get(g.item_id);
        out.push({ item_id: it.id, item_qb_id: it.qb_id, name: it.name, description: it.description, qty: g.qty, unit_price: priceFor(it.id) });
      } else {
        out.push({ item_id: null, item_qb_id: null, name: g.label || 'Load', description: null, qty: g.qty, unit_price: 0 });
      }
    }
    // Fuel surcharge — one line, qty = number of loads, at the customer's rate.
    const fuel = (items || []).find((i) => /fuel/i.test(i.name));
    if (fuel) {
      const totalLoads = loads.length;
      out.push({ item_id: fuel.id, item_qb_id: fuel.qb_id, name: fuel.name, description: fuel.description, qty: totalLoads, unit_price: priceFor(fuel.id) });
    }
    setLines(out);
  }, [prices, lines, job, items, itemById]);

  const total = (lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);

  const setLine = (i, patch) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const removeLine = (i) => setLines((p) => p.filter((_, idx) => idx !== i));
  const addLine = (itemId) => {
    const it = itemById.get(itemId);
    if (!it) return;
    setLines((p) => [...p, { item_id: it.id, item_qb_id: it.qb_id, name: it.name, description: it.description, qty: 1, unit_price: priceFor(it.id) }]);
  };

  const create = async () => {
    setSaving(true);
    setError('');
    try {
      const { data: num, error: numErr } = await supabase.rpc('next_invoice_number');
      if (numErr) throw numErr;
      const finalLines = (lines || []).map((l) => ({
        ...l,
        qty: Number(l.qty) || 0,
        unit_price: Number(l.unit_price) || 0,
        amount: Math.round((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * 100) / 100,
      })).filter((l) => l.qty > 0);
      const due = addDays(job.scheduled_date, 30);
      await base44.entities.Invoice.create({
        customer_id: job.customer_id,
        job_id: job.id,
        doc_number: num,
        txn_date: job.scheduled_date,
        due_date: due,
        total: Math.round(total * 100) / 100,
        balance: Math.round(total * 100) / 100,
        status: 'open',
        lines: finalLines,
        source: 'app',
        note: note.trim() || null,
      });
      onCreated();
    } catch (e) {
      setError(e.message || 'Could not create the invoice.');
      setSaving(false);
    }
  };

  if (lines === null) {
    return <div className="border-t border-gray-100 px-4 py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
            <th className="py-1.5 font-medium">Item</th>
            <th className="py-1.5 px-2 font-medium w-16 text-right">Qty</th>
            <th className="py-1.5 px-2 font-medium w-28 text-right">Price</th>
            <th className="py-1.5 px-2 font-medium w-24 text-right">Amount</th>
            <th className="py-1.5 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const std = l.item_id ? itemById.get(l.item_id)?.unit_price : null;
            const custom = std != null && Math.abs(Number(std) - Number(l.unit_price)) > 0.004;
            return (
              <tr key={i} className="border-t border-gray-50">
                <td className="py-1.5 pr-2">
                  <p className="text-sm text-gray-900">{l.name}</p>
                  {std != null && (
                    <p className="text-[10px] text-gray-400">standard ${Number(std).toLocaleString()}{custom ? ' — this invoice only' : ''}</p>
                  )}
                </td>
                <td className="py-1.5 px-2">
                  <Input type="number" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} className="h-8 text-sm text-right" />
                </td>
                <td className="py-1.5 px-2">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-xs">$</span>
                    <Input type="number" step="0.01" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} className={cn('h-8 text-sm text-right', custom && 'border-amber-300 bg-amber-50/50')} />
                  </div>
                </td>
                <td className="py-1.5 px-2 text-sm font-medium text-gray-900 text-right whitespace-nowrap">
                  {money((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}
                </td>
                <td className="py-1.5 text-right">
                  <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex items-center gap-2 mt-2">
        <select
          value={addingItem}
          onChange={(e) => { if (e.target.value) { addLine(e.target.value); setAddingItem(''); } }}
          className="h-8 text-xs border border-gray-200 rounded-md px-2 bg-white text-gray-500"
        >
          <option value="">+ Add item…</option>
          {(items || []).filter((i) => i.active).map((i) => (
            <option key={i.id} value={i.id}>{i.name}{i.unit_price != null ? ` — $${i.unit_price}` : ''}</option>
          ))}
        </select>
        <Input
          placeholder="Invoice note (optional)…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        <span className="text-sm font-bold text-gray-900 whitespace-nowrap ml-2">Total {money(total)}</span>
      </div>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      <div className="flex items-center gap-2 mt-3">
        <Button size="sm" className="h-8 bg-gray-950 hover:bg-gray-800" onClick={create} disabled={saving || total <= 0}>
          {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          {isBatch
            ? (batchInfo.index + 1 >= batchInfo.count ? 'Done' : 'Next')
            : 'Create invoice'}
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={onCancel}>Cancel</Button>
        {isBatch && <span className="text-[11px] text-gray-400">Saves this invoice and {batchInfo.index + 1 >= batchInfo.count ? 'finishes the batch' : 'opens the next job'}.</span>}
      </div>
    </div>
  );
}

/* ----------------------------- Printing --------------------------------- */

// Renders the selected invoices into a hidden print layer (one per page),
// opens the print dialog, and reports back whether printing was attempted.
function PrintInvoices({ invoices, custById, company, onDone }) {
  useEffect(() => {
    document.body.classList.add('printing-invoices');
    const after = () => {
      window.removeEventListener('afterprint', after);
      document.body.classList.remove('printing-invoices');
      onDone(true);
    };
    window.addEventListener('afterprint', after);
    const t = setTimeout(() => window.print(), 150);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', after);
      document.body.classList.remove('printing-invoices');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="invoice-print-root">
      {invoices.map((inv) => (
        <div key={inv.id} className="invoice-print-page">
          <InvoiceTemplate invoice={inv} customer={custById.get(inv.customer_id)} company={company} />
        </div>
      ))}
    </div>,
    document.body
  );
}
