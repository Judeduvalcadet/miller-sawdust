import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Truck, Package, RefreshCw, LogOut, StickyNote, MapPin, ChevronRight } from 'lucide-react';
import { startOfWeek, endOfWeek, isToday, isTomorrow, isWithinInterval } from 'date-fns';
import { base44 } from '@/api/entities';
import { logout } from '@/api/authClient';
import { cn } from '@/lib/utils';
import JobDetail from '@/components/driver/JobDetail';

// V2 driver app — the V1 driver flows (job detail, per-load completion,
// spreader pickup logging) stay exactly as they are; this is the V2 design
// language wrapped around them, starting with the job list.

const STATUS_BORDER = {
  pending: 'border-l-gray-300',
  in_progress: 'border-l-blue-500',
  completed: 'border-l-green-500',
};
const STATUS_CHIP = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
};

function configLine(job) {
  if (Array.isArray(job.loads) && job.loads.length > 0) {
    const configs = job.loads.filter((l) => l.load_configuration).map((l, i) => `L${l.load_number || i + 1}: ${l.load_configuration}`);
    if (configs.length) return configs.join(' · ');
  }
  return job.load_configuration || null;
}

function DriverJobCard({ job, onOpen }) {
  const isPickup = job.job_type === 'pickup';
  const hasNotes = !!((job.dispatcher_notes || '').trim() || (job.driver_notes || '').trim());
  const yards = isPickup ? job.pickup_yards : job.delivery_yards;
  const config = configLine(job);
  return (
    <button
      onClick={onOpen}
      className={cn(
        'w-full text-left bg-white rounded-xl border border-gray-200 border-l-4 px-4 py-3 shadow-sm active:bg-gray-50',
        STATUS_BORDER[job.status] || 'border-l-gray-300'
      )}
    >
      <div className="flex items-center gap-1.5">
        {isPickup
          ? <Package className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          : <Truck className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
        <span className={cn('text-[11px] font-bold uppercase', isPickup ? 'text-amber-700' : 'text-blue-700')}>
          {job.job_type}
        </span>
        {hasNotes && (
          <span className="inline-flex items-center gap-0.5 bg-black text-white text-[9px] px-1.5 py-0.5 rounded font-semibold">
            <StickyNote className="w-2.5 h-2.5" /> NOTE
          </span>
        )}
        <span className={cn('ml-auto text-[10px] font-medium rounded-full px-2 py-0.5', STATUS_CHIP[job.status] || STATUS_CHIP.pending)}>
          {job.status === 'in_progress' ? 'in progress' : job.status}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[15px] text-gray-900 truncate">{job.location_name}</p>
          {job.address && (
            <p className="text-xs text-gray-500 truncate flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 shrink-0" /> {job.address}
            </p>
          )}
          <p className="text-xs text-gray-600 mt-0.5">
            {job.quantity || 1} load{(job.quantity || 1) !== 1 ? 's' : ''}
            {yards ? ` · ${yards} yds` : ''}
          </p>
          {config && <p className="text-xs text-gray-500 truncate mt-0.5">{config}</p>}
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
      </div>
    </button>
  );
}

export default function V2Driver() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('today');
  const [selectedJob, setSelectedJob] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const driverId = typeof window !== 'undefined' ? localStorage.getItem('miller_driver_id') : null;
  const driverName = typeof window !== 'undefined' ? (localStorage.getItem('miller_driver_name') || 'Driver') : 'Driver';

  useEffect(() => {
    if (!driverId) window.location.href = '/DriverLogin';
  }, [driverId]);

  const { data: jobs = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['v2-driver-jobs', driverId],
    enabled: !!driverId,
    refetchInterval: 30000,
    queryFn: () => base44.entities.Job.filter({ assigned_driver_id: driverId }, '-scheduled_date', 5000),
  });
  const { data: pickupLocations = [] } = useQuery({
    queryKey: ['v2-driver-pickups'],
    queryFn: () => base44.entities.PickupLocation.list('name'),
    staleTime: 300000,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ['v2-customers'],
    queryFn: () => base44.entities.Customer.list(undefined, 5000),
    staleTime: 300000,
  });
  const { data: items = [] } = useQuery({
    queryKey: ['driver-load-items'],
    queryFn: () => base44.entities.Item.filter({ is_load_item: true, active: true }, 'sort_order'),
    staleTime: 300000,
  });

  const buckets = useMemo(() => {
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    const live = jobs.filter((j) => j.status !== 'cancelled' && !j.deleted_at);
    const dated = (j) => new Date(j.scheduled_date + 'T00:00:00');
    return {
      today: live.filter((j) => isToday(dated(j))),
      tomorrow: live.filter((j) => isTomorrow(dated(j))),
      week: live.filter((j) => isWithinInterval(dated(j), { start: weekStart, end: weekEnd }) && !isToday(dated(j)) && !isTomorrow(dated(j))),
    };
  }, [jobs]);

  const shown = buckets[tab] || [];
  const sortKey = (j) => `${j.status === 'completed' ? 1 : 0}-${j.scheduled_date}-${j.sort_order ?? 999}`;
  const sorted = [...shown].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const handleUpdateJob = async (updates) => {
    setIsUpdating(true);
    try {
      await base44.entities.Job.update(selectedJob.id, updates);
      setSelectedJob({ ...selectedJob, ...updates });
      queryClient.invalidateQueries({ queryKey: ['v2-driver-jobs'] });
    } finally {
      setIsUpdating(false);
    }
  };

  if (selectedJob) {
    return (
      <JobDetail
        job={selectedJob}
        onBack={() => { setSelectedJob(null); refetch(); }}
        onUpdate={handleUpdateJob}
        isUpdating={isUpdating}
        pickupLocations={pickupLocations}
        driverName={driverName}
        customer={customers.find((c) => c.id === selectedJob.customer_id) || null}
        deYellow
        items={items}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-10">
      {/* Header — the V2 dark bar */}
      <div className="bg-gray-950 text-white px-4 pt-4 pb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src="/logo.jpg" alt="" className="w-10 h-10 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-gray-400 leading-tight">Miller Sawdust · Driver</p>
            <p className="font-bold text-lg leading-tight truncate">{driverName}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2.5 rounded-xl hover:bg-white/10 text-gray-300"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('w-5 h-5', isFetching && 'animate-spin')} />
          </button>
          <button
            onClick={async () => { await logout(); window.location.href = '/DriverLogin'; }}
            className="p-2.5 rounded-xl hover:bg-white/10 text-gray-300"
            aria-label="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
        {import.meta.env.MODE === 'sandbox' && (
          <span className="inline-block mt-2 text-[10px] font-bold tracking-wide bg-amber-500 text-gray-950 rounded px-1.5 py-0.5">
            SANDBOX: local data
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3">
        <div className="flex gap-0.5 bg-gray-200/70 rounded-xl p-1">
          {[['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This Week']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-colors',
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              )}
            >
              {label}
              {buckets[key]?.length > 0 && (
                <span className={cn(
                  'text-[10px] font-bold rounded-full px-1.5 py-0.5',
                  tab === key ? 'bg-gray-950 text-white' : 'bg-gray-300/80 text-gray-600'
                )}>
                  {buckets[key].length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Job list */}
      <div className="px-4 pt-3 space-y-2.5">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : sorted.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 py-12 text-center">
            <Truck className="w-8 h-8 text-gray-300 mx-auto" />
            <p className="text-sm text-gray-400 mt-2">
              No jobs {tab === 'today' ? 'today' : tab === 'tomorrow' ? 'tomorrow' : 'later this week'}.
            </p>
          </div>
        ) : (
          sorted.map((job) => (
            <DriverJobCard key={job.id} job={job} onOpen={() => setSelectedJob(job)} />
          ))
        )}
      </div>
    </div>
  );
}
