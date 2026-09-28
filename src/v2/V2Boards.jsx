import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2, ChevronLeft, ChevronRight, CalendarDays, Plus, Search, User,
  ArrowUpDown, WifiOff,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { base44 } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { cn } from '@/lib/utils';
import DispatchJobCard from '@/components/admin/DispatchJobCard';
import JobForm from '@/components/admin/JobForm';
import SortJobsModal from '@/components/admin/SortJobsModal';
import GlobalSearch from '@/components/admin/GlobalSearch';

// V2 boards — dispatch (light, full toolkit) and wallboard (dark, display
// only). Shared layout: a drivers rail on the left (photo + name), and the
// selected day's jobs flowing horizontally per driver on the right. A Mon–Fri
// strip with week arrows and a dotted calendar sits above; day/week toggle.

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
        dark ? 'bg-white/10 text-white/80' : 'bg-amber-100 text-amber-700')}
    >
      {initials || <User className="w-5 h-5" />}
    </div>
  );
}

/* ------------------------- day strip + calendar -------------------------- */

function DayStrip({ day, onChangeDay, weekJobsByDate, dark }) {
  const weekStart = mondayOf(day);
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  const [calMonth, setCalMonth] = useState(new Date(day + 'T00:00:00'));

  // dots: which days of the visible calendar month have jobs
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
          const active = day === d;
          return (
            <button
              key={d}
              onClick={() => onChangeDay(d)}
              className={cn(
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
          <style>{`.board-cal-dot { position: relative; } .board-cal-dot::after { content:''; position:absolute; bottom:3px; left:50%; transform:translateX(-50%); width:4px; height:4px; border-radius:9999px; background:#d97706; }`}</style>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ----------------------------- board grid -------------------------------- */

function BoardGrid({ drivers, weekJobsByDate, day, view, dark, readOnly, filter, onEdit, onCancel, onSortDay }) {
  const weekStart = mondayOf(day);
  const days = view === 'week' ? Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)) : [day];

  const match = (job) => {
    if (!filter) return true;
    const hay = `${job.location_name || ''} ${job.customer_company_name || ''} ${job.assigned_driver_name || ''}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  };

  const jobsFor = (driverId, d) =>
    (weekJobsByDate.get(d) || [])
      .filter((j) => (driverId ? j.assigned_driver_id === driverId : !j.assigned_driver_id))
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

  // Only drivers with something in view get a row — no dead rows for
  // whoever is off that day.
  const activeDrivers = drivers.filter((d) =>
    d.active && d.role !== 'dispatcher' && d.role !== 'assistant' && d.name !== 'Wallboard TV' &&
    days.some((day) => jobsFor(d.id, day).length > 0)
  );
  const hasUnassigned = days.some((d) => jobsFor(null, d).length > 0);
  const rows = [...activeDrivers.map((d) => ({ key: d.id, driver: d })), ...(hasUnassigned ? [{ key: 'unassigned', driver: null }] : [])];

  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const cardWrap = (job) => (
    <div key={job.id} className={cn('w-[300px] shrink-0 transition-opacity', dark && 'bg-white rounded-xl', filter && !match(job) && 'opacity-25')}>
      <DispatchJobCard
        job={job}
        driver={driverById.get(job.assigned_driver_id) || null}
        readOnly={readOnly}
        onEdit={onEdit}
        onCancel={onCancel}
      />
    </div>
  );

  return (
    <div className={cn('flex-1 min-h-0 overflow-y-auto rounded-2xl border', dark ? 'border-white/10' : 'border-gray-200 bg-white')}>
      {/* header row */}
      <div className={cn('flex sticky top-0 z-10 text-[11px] uppercase tracking-wide', dark ? 'bg-gray-950 text-gray-500' : 'bg-white text-gray-400 shadow-[0_1px_0_0_#f3f4f6]')}>
        <div className={cn('w-[10%] min-w-[110px] shrink-0 px-3 py-2.5 font-medium border-r', dark ? 'border-white/10' : 'border-gray-100')}>Drivers</div>
        <div className="flex-1 flex">
          {days.map((d) => (
            <div key={d} className="flex-1 px-3 py-2.5 font-medium flex items-center gap-2">
              {view === 'week' ? `${new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })} ${fmtDay(d)}` : 'Jobs'}
              {!readOnly && onSortDay && (
                <button onClick={() => onSortDay(d)} className={cn('p-0.5 rounded', dark ? 'hover:bg-white/10' : 'hover:bg-gray-100')} title="Reorder this day's routes">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {rows.map(({ key, driver }) => (
        <div key={key} className={cn('flex border-t', dark ? 'border-white/10' : 'border-gray-100')}>
          {/* drivers rail */}
          <div className={cn('w-[10%] min-w-[110px] shrink-0 px-3 py-4 border-r flex flex-col items-center gap-2 text-center', dark ? 'border-white/10' : 'border-gray-100')}>
            {driver ? (
              <>
                <DriverAvatar driver={driver} size={52} dark={dark} />
                <p className={cn('text-sm font-semibold leading-tight', dark ? 'text-white' : 'text-gray-900')}>{driver.name}</p>
              </>
            ) : (
              <>
                <div className={cn('w-[52px] h-[52px] rounded-full border-2 border-dashed flex items-center justify-center', dark ? 'border-white/20 text-white/40' : 'border-gray-300 text-gray-400')}>?</div>
                <p className={cn('text-sm font-semibold', dark ? 'text-gray-300' : 'text-gray-500')}>Unassigned</p>
              </>
            )}
          </div>
          {/* jobs */}
          <div className="flex-1 flex min-w-0">
            {days.map((d) => {
              const dayJobs = jobsFor(driver?.id, d);
              return (
                <div key={d} className={cn('flex-1 min-w-0 p-3', view === 'week' && 'border-l first:border-l-0', dark ? 'border-white/5' : 'border-gray-50')}>
                  {dayJobs.length === 0 ? (
                    <p className={cn('text-xs italic py-6 text-center', dark ? 'text-gray-600' : 'text-gray-300')}>—</p>
                  ) : view === 'week' ? (
                    <div className="space-y-2">{dayJobs.map(cardWrap)}</div>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-1">{dayJobs.map(cardWrap)}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {rows.length === 0 && (
        <p className={cn('p-10 text-sm italic text-center', dark ? 'text-gray-500' : 'text-gray-400')}>
          Nothing scheduled {view === 'week' ? 'this week' : 'for this day'}.
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
  const [sortDate, setSortDate] = useState(null);

  const { byDate, isLoading, refetch } = useWeekJobs(day);
  const { data: drivers = [] } = useQuery({ queryKey: ['drivers'], queryFn: () => base44.entities.Driver.list('name') });
  const { data: customers = [] } = useQuery({ queryKey: ['v2-customers'], queryFn: () => base44.entities.Customer.list('name', 5000) });
  const { data: pickupLocations = [] } = useQuery({ queryKey: ['pickup-locations'], queryFn: () => base44.entities.PickupLocation.list('name') });
  const { data: dropOffLocations = [] } = useQuery({ queryKey: ['dropoff-locations'], queryFn: () => base44.entities.DropOffLocation.list('name') });
  const allJobs = useMemo(() => [...byDate.values()].flat(), [byDate]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['board-week-jobs'] });
  const createJob = useMutation({ mutationFn: (data) => base44.entities.Job.create(data), onSuccess: () => { invalidate(); setShowJobForm(false); } });
  const updateJob = useMutation({ mutationFn: ({ id, data }) => base44.entities.Job.update(id, data), onSuccess: () => { invalidate(); setShowJobForm(false); setEditingJob(null); } });
  const deleteJob = useMutation({ mutationFn: (id) => base44.entities.Job.update(id, { deleted_at: new Date().toISOString() }), onSuccess: () => { invalidate(); setShowJobForm(false); setEditingJob(null); } });

  const onEdit = (job) => { setEditingJob(job); setShowJobForm(true); };
  const onCancel = async (job) => {
    if (window.confirm('Cancel this job?')) {
      await base44.entities.Job.update(job.id, { status: 'cancelled' });
      invalidate();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-5 gap-3">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <DayStrip day={day} onChangeDay={setDay} weekJobsByDate={byDate} />
        <div className="flex gap-0.5 bg-gray-200/70 rounded-lg p-0.5 ml-1">
          {[['day', 'Day'], ['week', 'Week']].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={cn('px-3 py-1.5 text-xs font-medium rounded-md', view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>{l}</button>
          ))}
        </div>
        <div className="relative ml-1">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Filter this board…" value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-8 h-9 w-48 bg-white" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <GlobalSearch />
          <Button size="sm" className="bg-gray-950 hover:bg-gray-800" onClick={() => { setEditingJob(null); setShowJobForm(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> New Job
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <BoardGrid
          drivers={drivers}
          weekJobsByDate={byDate}
          day={day}
          view={view}
          filter={filter}
          onEdit={onEdit}
          onCancel={onCancel}
          onSortDay={(d) => setSortDate(d)}
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
              job={editingJob || { scheduled_date: day }}
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
        open={!!sortDate}
        onClose={() => { setSortDate(null); invalidate(); }}
        jobs={allJobs}
        drivers={drivers}
        preSelectedDate={sortDate}
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
  const [manualUntil, setManualUntil] = useState(null); // day the user navigated to

  // Auto-advance: at midnight (checked every 30s) snap back to today.
  useEffect(() => {
    const t = setInterval(() => {
      const today = iso(new Date());
      setDay((cur) => {
        if (manualUntil && manualUntil >= today) return cur; // user is browsing
        return cur === today ? cur : today;
      });
      if (manualUntil && manualUntil < today) setManualUntil(null);
    }, 30000);
    return () => clearInterval(t);
  }, [manualUntil]);

  // Resilient: keep the last good data on errors, retry forever, refetch often.
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

  const changeDay = (d) => { setDay(d); setManualUntil(d); };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-5 gap-3 bg-gray-950">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold text-white mr-2">
          {new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h1>
        <DayStrip day={day} onChangeDay={changeDay} weekJobsByDate={byDate} dark />
        <div className="flex gap-0.5 bg-white/10 rounded-lg p-0.5 ml-1">
          {[['day', 'Day'], ['week', 'Week']].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={cn('px-3 py-1.5 text-xs font-medium rounded-md', view === v ? 'bg-white text-gray-950' : 'text-gray-400 hover:text-white')}>{l}</button>
          ))}
        </div>
        {isError && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-amber-400">
            <WifiOff className="w-4 h-4" /> reconnecting — showing the last good schedule
          </span>
        )}
      </div>

      {isLoading && byDate.size === 0 ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : (
        <BoardGrid drivers={drivers} weekJobsByDate={byDate} day={day} view={view} dark readOnly />
      )}
    </div>
  );
}
