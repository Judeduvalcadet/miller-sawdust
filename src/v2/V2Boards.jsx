import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2, ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Plus, Search,
  User, ArrowUpDown, WifiOff, Truck, Package, MoreHorizontal, Pencil, Trash2,
  StickyNote, UserPlus, Receipt,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { base44 } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { cn } from '@/lib/utils';
import JobForm from '@/components/admin/JobForm';
import SortJobsModal from '@/components/admin/SortJobsModal';
import GlobalSearch from '@/components/admin/GlobalSearch';
import MiniWallboard from '@/components/admin/MiniWallboard';

// V2 boards. Day view: drivers rail + the day's jobs per driver, unassigned
// pinned on top. Week view on dispatch: the V1 board (MiniWallboard),
// unchanged. Wallboard: same day grid, dark, display-only, neutral cards.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function DriverAvatar({ driver, size = 48, dark = false }) {
  if (driver?.avatar_url) {
    return <img src={driver.avatar_url} alt="" style={{ width: size, height: size }} className="rounded-full object-cover" />;
  }
  const initials = (driver?.name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return (
    <div
      style={{ width: size, height: size }}
      className={cn('rounded-full flex items-center justify-center font-bold',
        dark ? 'bg-white/10 text-white/80' : 'bg-gray-200 text-gray-700')}
    >
      {initials || <User className="w-5 h-5" />}
    </div>
  );
}

/* ------------------------- day strip + calendar -------------------------- */

function DayStrip({ day, onChangeDay, weekJobsByDate, dark, disabled }) {
  const weekStart = mondayOf(day);
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  const [calMonth, setCalMonth] = useState(new Date(day + 'T00:00:00'));

  const { data: monthDates } = useQuery({
    queryKey: ['board-month-dates', calMonth.getFullYear(), calMonth.getMonth()],
    queryFn: async () => {
      const from = iso(new Date(calMonth.getFullYear(), calMonth.getMonth(), 1));
      const to = iso(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0));
      const { data, error } = await supabase.from('jobs').select('scheduled_date')
        .is('deleted_at', null).gte('scheduled_date', from).lte('scheduled_date', to);
      if (error) throw error;
      return [...new Set((data || []).map((r) => r.scheduled_date))].map((s) => new Date(s + 'T00:00:00'));
    },
  });

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChangeDay(addDays(weekStart, -7))} className={cn('p-1.5 rounded-lg', dark ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-200 text-gray-500')} aria-label="Previous week">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="flex gap-1.5">
        {weekDays.map((d) => {
          const dt = new Date(d + 'T00:00:00');
          const count = (weekJobsByDate?.get(d) || []).length;
          const active = day === d && !disabled;
          return (
            <button
              key={d}
              onClick={() => onChangeDay(d)}
              disabled={disabled}
              className={cn(
                disabled && 'opacity-40 cursor-not-allowed',
                'rounded-xl border px-3 py-1.5 text-center transition-colors min-w-[84px]',
                active
                  ? (dark ? 'bg-white text-gray-950 border-white' : 'bg-gray-950 text-white border-gray-950')
                  : (dark ? 'bg-white/5 text-gray-300 border-white/10 hover:border-white/30' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400')
              )}
            >
              <p className="text-[10px] uppercase tracking-wide opacity-70">{dt.toLocaleDateString('en-US', { weekday: 'short' })}</p>
              <p className="text-sm font-semibold leading-tight">{fmtDay(d)}</p>
              <p className={cn('text-[10px]', active ? 'opacity-60' : 'opacity-50')}>{count} job{count !== 1 ? 's' : ''}</p>
            </button>
          );
        })}
      </div>
      <button onClick={() => onChangeDay(addDays(weekStart, 7))} className={cn('p-1.5 rounded-lg', dark ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-200 text-gray-500')} aria-label="Next week">
        <ChevronRight className="w-4 h-4" />
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button className={cn('p-2 rounded-lg', dark ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-200 text-gray-600')} title="Open calendar">
            <CalendarDays className="w-5 h-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <Calendar
            mode="single"
            selected={new Date(day + 'T00:00:00')}
            onSelect={(d) => { if (d) onChangeDay(iso(d)); }}
            month={calMonth}
            onMonthChange={setCalMonth}
            modifiers={{ hasJobs: monthDates || [] }}
            modifiersClassNames={{ hasJobs: 'board-cal-dot' }}
          />
          <style>{`.board-cal-dot { position: relative; } .board-cal-dot::after { content:''; position:absolute; bottom:3px; left:50%; transform:translateX(-50%); width:4px; height:4px; border-radius:9999px; background:#111827; }`}</style>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ------------------------------ job card --------------------------------- */
// Compact day-view card: type icon inline with the title, no address.
// Badges follow V1: black NOTE pill; green INVOICED pill (admin dispatch
// only) when the job's linked invoice was sent; V1-style Assign/Reassign.

function BoardJobCard({ job, driver, drivers = [], readOnly, neutral, invoiced, onEdit, onCancel, onAssign }) {
  const isCompleted = job.status === 'completed';
  const isCancelled = job.status === 'cancelled';
  const isPending = job.status === 'pending';
  const isPickup = job.job_type === 'pickup';
  const name = (job.customer_company_name || job.location_name || '').trim() || '—';
  const yards = isPickup ? job.pickup_yards : job.delivery_yards;
  const configs = ((job.loads || []).map((l) => l.load_configuration).filter(Boolean).join(', ')
    || job.load_configuration || '').trim();
  const hasNotes = !!((job.dispatcher_notes && job.dispatcher_notes.trim()) || (job.driver_notes && job.driver_notes.trim()));
  const TypeIcon = isPickup ? Package : Truck;
  const assignable = drivers.filter((d) => d.active && d.role !== 'dispatcher' && d.role !== 'assistant' && d.name !== 'Wallboard TV');

  return (
    <Card className={cn(
      'p-3 border-l-4 h-full flex flex-col',
      neutral
        ? 'border-l-gray-300 bg-white'
        : cn(
          isPending && 'border-l-gray-300 bg-gray-50/40',
          isCompleted && 'border-l-green-500 bg-green-50/30',
          isCancelled && 'border-l-gray-400 bg-gray-50 opacity-60',
          !isPending && !isCompleted && !isCancelled && 'border-l-blue-400'
        )
    )}>
      <div className="flex items-start justify-between gap-1 flex-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <TypeIcon className={cn('w-3.5 h-3.5 shrink-0', isPickup ? 'text-amber-600' : 'text-blue-600')} />
            <span className={cn('text-[10px] font-semibold uppercase shrink-0', isPickup ? 'text-amber-700' : 'text-blue-700')}>
              {job.job_type}
            </span>
            <Badge className={cn(
              'text-[10px] px-1.5 py-0 shrink-0',
              isCompleted ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            )}>
              {job.status}
            </Badge>
            {hasNotes && (
              <span className="inline-flex items-center gap-0.5 bg-black text-white text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0">
                <StickyNote className="w-2.5 h-2.5" /> NOTE
              </span>
            )}
          </div>
          <p className="font-semibold text-sm text-gray-900 truncate mt-0.5">{name}</p>
          <p className="text-xs text-gray-500 truncate">
            {fmtDay(job.scheduled_date)}
            {(driver?.name || job.assigned_driver_name) ? ` · ${driver?.name || job.assigned_driver_name}` : ''}
            {` · ${job.quantity || 1} load${(job.quantity || 1) !== 1 ? 's' : ''}`}
            {yards ? ` · ${yards} yds` : ''}
          </p>
          {configs && (
            <p className="text-xs font-medium text-gray-700 truncate mt-0.5">{configs}</p>
          )}
        </div>
        {!readOnly && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button className="text-gray-300 hover:text-gray-700 p-0.5 rounded hover:bg-gray-100 shrink-0 -mr-1 -mt-1">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(job)}><Pencil className="w-4 h-4 mr-2" /> Edit</DropdownMenuItem>
              {job.status !== 'cancelled' && (
                <DropdownMenuItem onClick={() => onCancel(job)} className="text-red-600 focus:text-red-600">
                  <Trash2 className="w-4 h-4 mr-2" /> Cancel Job
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {invoiced && (
        <div className="mt-1.5 flex justify-end">
          <span className="inline-flex items-center gap-0.5 bg-green-600 text-white text-[9px] px-1.5 py-0.5 rounded font-semibold">
            <Receipt className="w-2.5 h-2.5" /> INVOICED
          </span>
        </div>
      )}

      {/* Assign / Reassign — same behavior and look as V1 */}
      {!readOnly && !isCancelled && !isCompleted && onAssign && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className={cn(
              'mt-2 self-start inline-flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-semibold transition-colors',
              job.assigned_driver_id
                ? 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                : 'bg-gray-950 hover:bg-gray-800 text-white'
            )}>
              <UserPlus className="w-2.5 h-2.5" />
              {job.assigned_driver_id ? 'Reassign' : 'Assign'}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            {assignable.map((d) => (
              <DropdownMenuItem key={d.id} onClick={() => onAssign(job, d.id)} className={cn(job.assigned_driver_id === d.id && 'font-semibold')}>
                <DriverAvatar driver={d} size={20} /> <span className="ml-2">{d.name}</span>
              </DropdownMenuItem>
            ))}
            {job.assigned_driver_id && (
              <DropdownMenuItem onClick={() => onAssign(job, null)} className="text-red-600 focus:text-red-600">Unassign</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </Card>
  );
}

/* --------------------- unassigned: fit-to-width row ---------------------- */

function UnassignedCards({ jobs, expanded, onToggle, renderCard }) {
  const ref = useRef(null);
  const [fit, setFit] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setFit(Math.max(1, Math.floor((el.clientWidth + 12) / (260 + 12))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const visible = expanded ? jobs : jobs.slice(0, fit);
  const hidden = jobs.length - visible.length;
  return (
    <div ref={ref} className="min-w-0">
      <div className={cn('gap-3', expanded ? 'flex flex-wrap' : 'flex overflow-hidden')}>
        {visible.map((j) => renderCard(j, true))}
      </div>
      {hidden > 0 && (
        <button onClick={onToggle} className="mt-2 text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline">
          + {hidden} more unassigned job{hidden !== 1 ? 's' : ''}
        </button>
      )}
      {expanded && jobs.length > fit && (
        <button onClick={onToggle} className="mt-2 text-xs text-gray-400 hover:text-gray-700 hover:underline">
          Show fewer
        </button>
      )}
    </div>
  );
}

/* ----------------------------- board grid -------------------------------- */
// Day-view grid: unassigned pinned first, then drivers with jobs that day.

function BoardGrid({ drivers, weekJobsByDate, day, dark, neutral, readOnly, filter, invoicedMap, onEdit, onCancel, onAssign, onSortDay, headerExtra }) {
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  const match = (job) => {
    if (!filter) return true;
    const hay = `${job.location_name || ''} ${job.customer_company_name || ''} ${job.assigned_driver_name || ''}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  };

  const jobsFor = (driverId) =>
    (weekJobsByDate.get(day) || [])
      .filter((j) => (driverId ? j.assigned_driver_id === driverId : !j.assigned_driver_id))
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

  const activeDrivers = drivers.filter((d) =>
    d.active && d.role !== 'dispatcher' && d.role !== 'assistant' && d.name !== 'Wallboard TV' &&
    jobsFor(d.id).length > 0
  );
  const unassignedJobs = jobsFor(null);
  const dayCount = (weekJobsByDate.get(day) || []).length;

  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const renderCard = (job, fixed = false) => (
    <div
      key={job.id}
      className={cn(
        'transition-opacity',
        fixed ? 'w-[260px] shrink-0' : 'flex-1 min-w-[210px] max-w-[300px]',
        dark && 'bg-white rounded-xl',
        filter && !match(job) && 'opacity-25'
      )}
    >
      <BoardJobCard
        job={job}
        driver={driverById.get(job.assigned_driver_id) || null}
        drivers={drivers}
        readOnly={readOnly}
        neutral={neutral}
        invoiced={!!invoicedMap?.get(job.id)}
        onEdit={onEdit}
        onCancel={onCancel}
        onAssign={onAssign}
      />
    </div>
  );

  const railCls = cn('w-[10%] min-w-[110px] shrink-0 px-3 border-r flex flex-col items-center text-center', dark ? 'border-white/10' : 'border-gray-100');

  return (
    <div className={cn('flex-1 min-h-0 overflow-y-auto rounded-2xl border', dark ? 'border-white/10' : 'border-gray-200 bg-white')}>
      {/* header — taller, holds the count and the board search */}
      <div className={cn('flex sticky top-0 z-10', dark ? 'bg-gray-950' : 'bg-white shadow-[0_1px_0_0_#f3f4f6]')}>
        <div className={cn(railCls, 'justify-center py-3')}>
          <span className={cn('text-[11px] uppercase tracking-wide font-medium', dark ? 'text-gray-500' : 'text-gray-400')}>Drivers</span>
        </div>
        <div className="flex-1 px-3 py-2.5 flex items-center gap-3">
          <span className={cn('text-[11px] uppercase tracking-wide font-medium whitespace-nowrap', dark ? 'text-gray-500' : 'text-gray-400')}>
            Jobs · {dayCount}
          </span>
          {headerExtra}
        </div>
      </div>

      {/* unassigned — always first */}
      {unassignedJobs.length > 0 && (
        <div className={cn('flex border-t', dark ? 'border-white/10' : 'border-gray-100')}>
          <div className={cn(railCls, 'py-4 gap-2')}>
            <div className={cn('w-[52px] h-[52px] rounded-full border-2 border-dashed flex items-center justify-center', dark ? 'border-white/20 text-white/40' : 'border-gray-300 text-gray-400')}>
              <UserPlus className="w-5 h-5" />
            </div>
            <p className={cn('text-sm font-semibold', dark ? 'text-gray-300' : 'text-gray-600')}>Unassigned</p>
            <button
              onClick={() => setUnassignedOpen((v) => !v)}
              className={cn('p-1 rounded-full', dark ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-400')}
              title={unassignedOpen ? 'Collapse' : 'Show all'}
            >
              <ChevronDown className={cn('w-4 h-4 transition-transform', unassignedOpen && 'rotate-180')} />
            </button>
          </div>
          <div className="flex-1 min-w-0 p-3">
            <UnassignedCards
              jobs={unassignedJobs}
              expanded={unassignedOpen}
              onToggle={() => setUnassignedOpen((v) => !v)}
              renderCard={renderCard}
            />
          </div>
        </div>
      )}

      {/* drivers with jobs */}
      {activeDrivers.map((driver) => (
        <div key={driver.id} className={cn('flex border-t', dark ? 'border-white/10' : 'border-gray-100')}>
          <div className={cn(railCls, 'py-4 gap-2 group relative')}>
            <DriverAvatar driver={driver} size={52} dark={dark} />
            <p className={cn('text-sm font-semibold leading-tight', dark ? 'text-white' : 'text-gray-900')}>{driver.name}</p>
            {!readOnly && onSortDay && (
              <button
                onClick={() => onSortDay(day, driver.id)}
                className="absolute bottom-1.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-950 text-white rounded-full p-1.5 shadow"
                title="Reorder routes"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0 p-3">
            <div className="flex gap-3 overflow-x-auto pb-1">
              {jobsFor(driver.id).map((j) => renderCard(j))}
            </div>
          </div>
        </div>
      ))}

      {unassignedJobs.length === 0 && activeDrivers.length === 0 && (
        <p className={cn('p-10 text-sm italic text-center', dark ? 'text-gray-500' : 'text-gray-400')}>
          Nothing scheduled for this day.
        </p>
      )}
    </div>
  );
}

/* --------------------------- data for a week ----------------------------- */

function useWeekJobs(day, opts = {}) {
  const weekStart = mondayOf(day);
  const q = useQuery({
    queryKey: ['board-week-jobs', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase.from('jobs').select('*')
        .is('deleted_at', null)
        .gte('scheduled_date', weekStart).lte('scheduled_date', addDays(weekStart, 6));
      if (error) throw error;
      return data;
    },
    ...opts,
  });
  const byDate = useMemo(() => {
    const m = new Map();
    for (const j of q.data || []) {
      (m.get(j.scheduled_date) || m.set(j.scheduled_date, []).get(j.scheduled_date)).push(j);
    }
    return m;
  }, [q.data]);
  return { ...q, byDate, weekStart };
}

/* ----------------------------- DISPATCH ---------------------------------- */

export function V2Dispatch() {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(iso(new Date()));
  const [view, setView] = useState('day');
  const [filter, setFilter] = useState('');
  const [showJobForm, setShowJobForm] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [defaultJobDate, setDefaultJobDate] = useState(null);
  const [sortTarget, setSortTarget] = useState(null); // { date, driverId? }

  const { byDate, isLoading } = useWeekJobs(day);
  const weekStart = mondayOf(day);
  const { data: drivers = [] } = useQuery({ queryKey: ['drivers'], queryFn: () => base44.entities.Driver.list('name') });
  const { data: customers = [] } = useQuery({ queryKey: ['v2-customers'], queryFn: () => base44.entities.Customer.list('name', 5000) });
  const { data: pickupLocations = [] } = useQuery({ queryKey: ['pickup-locations'], queryFn: () => base44.entities.PickupLocation.list('name') });
  const { data: dropOffLocations = [] } = useQuery({ queryKey: ['dropoff-locations'], queryFn: () => base44.entities.DropOffLocation.list('name') });
  const weekJobs = useMemo(() => [...byDate.values()].flat(), [byDate]);

  // The V1 board (week view) manages its own weeks — give it the full list.
  const { data: allJobs = [] } = useQuery({
    queryKey: ['v1-board-jobs'],
    enabled: view === 'week',
    queryFn: async () => (await base44.entities.Job.list('-scheduled_date', 6000)).filter((j) => !j.deleted_at),
  });

  // Green INVOICED badge: the job has a linked invoice (open or sent).
  // Queried by the week's job ids so invoices dated after the job still count.
  const weekJobIds = useMemo(() => weekJobs.map((j) => j.id), [weekJobs]);
  const { data: linkedInvoices = [] } = useQuery({
    queryKey: ['board-week-linked-invoices', weekStart, weekJobIds.length],
    enabled: weekJobIds.length > 0,
    queryFn: async () => {
      const out = [];
      for (let i = 0; i < weekJobIds.length; i += 100) {
        const { data, error } = await supabase.from('invoices').select('job_id, sent_at, status')
          .in('job_id', weekJobIds.slice(i, i + 100));
        if (error) throw error;
        out.push(...(data || []));
      }
      return out;
    },
  });
  const invoicedMap = useMemo(() => new Map(linkedInvoices.map((i) => [i.job_id, true])), [linkedInvoices]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['board-week-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['v1-board-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };
  const createJob = useMutation({ mutationFn: (data) => base44.entities.Job.create(data), onSuccess: () => { invalidate(); setShowJobForm(false); } });
  const updateJob = useMutation({ mutationFn: ({ id, data }) => base44.entities.Job.update(id, data), onSuccess: () => { invalidate(); setShowJobForm(false); setEditingJob(null); } });
  const deleteJob = useMutation({ mutationFn: (id) => base44.entities.Job.update(id, { deleted_at: new Date().toISOString() }), onSuccess: () => { invalidate(); setShowJobForm(false); setEditingJob(null); } });

  const onEdit = (job) => { setEditingJob(job); setDefaultJobDate(null); setShowJobForm(true); };
  const onCancel = async (job) => {
    if (window.confirm('Cancel this job?')) {
      await base44.entities.Job.update(job.id, { status: 'cancelled' });
      invalidate();
    }
  };
  const onAssign = async (job, driverId) => {
    const d = drivers.find((x) => x.id === driverId) || null;
    await base44.entities.Job.update(job.id, {
      assigned_driver_id: driverId || null,
      assigned_driver_name: d?.name || null,
      assigned_driver_pickup_role: d?.pickup_role || 'none',
    });
    invalidate();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-5 gap-3">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <DayStrip day={day} onChangeDay={setDay} weekJobsByDate={byDate} disabled={view === 'week'} />
        <div className="flex gap-0.5 bg-gray-200/70 rounded-lg p-0.5 ml-1">
          {[['day', 'Day'], ['week', 'Week']].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={cn('px-3 py-1.5 text-xs font-medium rounded-md', view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <GlobalSearch />
          <Button size="sm" className="bg-gray-950 hover:bg-gray-800" onClick={() => { setEditingJob(null); setDefaultJobDate(day); setShowJobForm(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> New Job
          </Button>
        </div>
      </div>

      {view === 'week' ? (
        /* The V1 dispatch board, exactly as-is */
        <div className="flex-1 min-h-0 overflow-y-auto">
          <MiniWallboard
            jobs={allJobs}
            drivers={drivers}
            pickupLocations={pickupLocations}
            isAdmin={true}
            weekAnchor={mondayOf(day)}
            onAddJob={(date) => { setEditingJob(null); setDefaultJobDate(date); setShowJobForm(true); }}
            onEditJob={onEdit}
            onSortJobs={(date) => setSortTarget({ date })}
          />
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <BoardGrid
          drivers={drivers}
          weekJobsByDate={byDate}
          day={day}
          filter={filter}
          invoicedMap={invoicedMap}
          onEdit={onEdit}
          onCancel={onCancel}
          onAssign={onAssign}
          onSortDay={(d, driverId) => setSortTarget({ date: d, driverId })}
          headerExtra={
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search this board…" value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-8 h-8 text-xs bg-gray-50" />
            </div>
          }
        />
      )}

      {/* New/Edit job — same close-proof popup as V1 */}
      <Dialog open={showJobForm} onOpenChange={() => {}}>
        <DialogContent
          className="w-[97vw] max-w-[92rem] max-h-[94vh] overflow-y-auto"
          hideClose
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {showJobForm && (
            <JobForm
              job={editingJob || { scheduled_date: defaultJobDate || day }}
              drivers={drivers}
              customers={customers}
              pickupLocations={pickupLocations}
              dropOffLocations={dropOffLocations}
              onSubmit={(data) => editingJob ? updateJob.mutate({ id: editingJob.id, data }) : createJob.mutate(data)}
              onDelete={editingJob ? () => deleteJob.mutate(editingJob.id) : undefined}
              onCancel={() => { setShowJobForm(false); setEditingJob(null); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <SortJobsModal
        open={!!sortTarget}
        onClose={() => { setSortTarget(null); invalidate(); }}
        jobs={view === 'week' ? allJobs : weekJobs}
        drivers={drivers}
        preSelectedDate={sortTarget?.date || null}
        preSelectedDriverId={sortTarget?.driverId || null}
        customers={customers}
        pickupLocations={pickupLocations}
        dropOffLocations={dropOffLocations}
      />
    </div>
  );
}

/* ----------------------------- WALLBOARD --------------------------------- */

export function V2Wallboard() {
  const [day, setDay] = useState(iso(new Date()));
  const [view, setView] = useState('day');
  const [manualUntil, setManualUntil] = useState(null);

  useEffect(() => {
    const t = setInterval(() => {
      const today = iso(new Date());
      setDay((cur) => {
        if (manualUntil && manualUntil >= today) return cur;
        return cur === today ? cur : today;
      });
      if (manualUntil && manualUntil < today) setManualUntil(null);
    }, 30000);
    return () => clearInterval(t);
  }, [manualUntil]);

  const { byDate, isError, isLoading } = useWeekJobs(day, {
    refetchInterval: 60000,
    retry: true,
    retryDelay: (n) => Math.min(30000, 2000 * (n + 1)),
    refetchOnWindowFocus: true,
  });
  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => base44.entities.Driver.list('name'),
    refetchInterval: 300000,
    retry: true,
  });
  const { data: pickupLocations = [] } = useQuery({ queryKey: ['pickup-locations'], queryFn: () => base44.entities.PickupLocation.list('name') });
  const { data: allJobs = [] } = useQuery({
    queryKey: ['v1-board-jobs'],
    enabled: view === 'week',
    refetchInterval: 60000,
    retry: true,
    queryFn: async () => (await base44.entities.Job.list('-scheduled_date', 6000)).filter((j) => !j.deleted_at),
  });

  const changeDay = (d) => { setDay(d); setManualUntil(d); };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-5 gap-3 bg-gray-950">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold text-white mr-2">
          {new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h1>
        <DayStrip day={day} onChangeDay={changeDay} weekJobsByDate={byDate} dark disabled={view === 'week'} />
        <div className="flex gap-0.5 bg-white/10 rounded-lg p-0.5 ml-1">
          {[['day', 'Day'], ['week', 'Week']].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={cn('px-3 py-1.5 text-xs font-medium rounded-md', view === v ? 'bg-white text-gray-950' : 'text-gray-400 hover:text-white')}>{l}</button>
          ))}
        </div>
        {isError && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-amber-400">
            <WifiOff className="w-4 h-4" /> reconnecting, showing the last good schedule
          </span>
        )}
      </div>

      {view === 'week' ? (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl bg-gray-100 p-2">
          <MiniWallboard
            jobs={allJobs}
            drivers={drivers}
            pickupLocations={pickupLocations}
            isAdmin={false}
            onAddJob={() => {}}
            onEditJob={() => {}}
            onSortJobs={() => {}}
          />
        </div>
      ) : isLoading && byDate.size === 0 ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : (
        <BoardGrid drivers={drivers} weekJobsByDate={byDate} day={day} dark neutral readOnly />
      )}
    </div>
  );
}
