import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/api/supabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, Truck, Factory, MapPinned, FileText, DollarSign, ChevronRight, CalendarClock } from "lucide-react";
import { formatDay } from '@/lib/job-history';

const TYPE_META = {
  customer: { label: 'Customer', icon: Building2 },
  driver: { label: 'Driver', icon: Truck },
  pickup: { label: 'Pickup Location', icon: Factory },
  dropoff: { label: 'Drop-Off Location', icon: MapPinned },
};

const STATUS_STYLES = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const PAGE = 1000;
const MAX = 5000;

async function fetchAllJobs(applyFilters) {
  const all = [];
  for (let from = 0; from < MAX; from += PAGE) {
    let q = supabase.from('jobs').select('*')
      .order('scheduled_date', { ascending: false })
      .order('created_date', { ascending: false })
      .range(from, from + PAGE - 1);
    q = applyFilters(q);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function fetchHistory({ type, record }) {
  if (type === 'customer') {
    // match by id AND by denormalized company name (legacy/CSV-imported jobs)
    const byId = await fetchAllJobs((q) => q.eq('customer_id', record.id));
    const name = record.company_name || record.name;
    let byName = [];
    if (name) {
      byName = await fetchAllJobs((q) => q.ilike('customer_company_name', name));
    }
    const seen = new Set(byId.map((j) => j.id));
    const merged = [...byId, ...byName.filter((j) => !seen.has(j.id))];
    return merged.sort((a, b) =>
      (b.scheduled_date || '').localeCompare(a.scheduled_date || '') ||
      (b.created_date || '').localeCompare(a.created_date || ''));
  }
  if (type === 'driver') return fetchAllJobs((q) => q.eq('assigned_driver_id', record.id));
  if (type === 'pickup') return fetchAllJobs((q) => q.eq('pickup_location_id', record.id));
  if (type === 'dropoff') return fetchAllJobs((q) => q.eq('dropoff_location_id', record.id));
  return [];
}

function jobYards(job) {
  const yards = job.job_type === 'pickup'
    ? (job.yards_collected ?? job.pickup_yards)
    : job.delivery_yards;
  return yards != null && yards !== '' ? `${yards} yd` : null;
}

export default function EntityHistoryOverlay({ selection, onClose }) {
  const { type, record } = selection;
  const meta = TYPE_META[type];
  const displayName = type === 'customer' ? (record.company_name || record.name) : record.name;
  const [showUpcoming, setShowUpcoming] = useState(false);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['entity-history', type, record.id],
    queryFn: () => fetchHistory(selection),
  });

  // Future jobs live in a collapsed section on top; history starts at the
  // most recent job that is today or in the past.
  const today = format(new Date(), 'yyyy-MM-dd');
  const upcoming = jobs
    .filter((j) => (j.scheduled_date || '') > today)
    .sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''));
  const past = jobs.filter((j) => (j.scheduled_date || '') <= today);

  const completed = jobs.filter((j) => j.status === 'completed').length;
  const totalYards = jobs.reduce((sum, j) => {
    const y = parseFloat(j.job_type === 'pickup' ? (j.yards_collected ?? j.pickup_yards) : j.delivery_yards);
    return sum + (Number.isFinite(y) ? y : 0);
  }, 0);

  const Icon = meta.icon;

  const renderRow = (job) => (
    <div key={job.id} className="px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-gray-50">
      <div className="w-40 shrink-0">
        <div className="text-sm font-medium text-gray-900">{formatDay(job.scheduled_date)}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${job.job_type === 'pickup' ? 'border-blue-300 text-blue-700' : 'border-amber-300 text-amber-700'}`}>
            {job.truck_type === 'spreader' ? 'Spreader' : job.job_type === 'pickup' ? 'Pickup' : 'Delivery'}
          </Badge>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border-0 ${STATUS_STYLES[job.status] || STATUS_STYLES.pending}`}>
            {(job.status || 'pending').replaceAll('_', ' ')}
          </Badge>
        </div>
      </div>

      <div className="flex-1 min-w-[180px]">
        <div className="text-sm text-gray-900 truncate">
          {type === 'customer'
            ? (job.location_name || job.address || job.customer_company_name || '—')
            : (job.customer_company_name || job.location_name || job.dropoff_location_name || '—')}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {[
            job.load_configuration,
            jobYards(job),
            job.quantity > 1 ? `${job.quantity} loads` : null,
          ].filter(Boolean).join(' · ') || 'No load details'}
        </div>
      </div>

      <div className="w-36 shrink-0 text-right">
        <div className="text-sm text-gray-700 truncate">
          {job.assigned_driver_name || <span className="text-gray-400">Unassigned</span>}
        </div>
        <div className="flex items-center justify-end gap-2 mt-0.5">
          {job.invoice_sent && <FileText className="w-3.5 h-3.5 text-blue-500" title="Invoiced" />}
          {job.payment_collected && <DollarSign className="w-3.5 h-3.5 text-green-600" title="Paid" />}
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-amber-700" />
            </div>
            <div className="min-w-0">
              <div className="truncate">{displayName}</div>
              <div className="text-xs font-normal text-gray-500">
                {meta.label}
                {!isLoading && (
                  <>
                    {' · '}{jobs.length} record{jobs.length === 1 ? '' : 's'}
                    {' · '}{completed} completed
                    {totalYards > 0 && <>{' · '}{Math.round(totalYards).toLocaleString()} yards total</>}
                    {jobs.length > 0 && (
                      <>{' · '}{formatDay(jobs[jobs.length - 1].scheduled_date)} → {formatDay(jobs[0].scheduled_date)}</>
                    )}
                  </>
                )}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-16">No records in the system for {displayName}.</p>
          ) : (
            <>
              {upcoming.length > 0 && (
                <div className="border-b bg-amber-50/60">
                  <button
                    type="button"
                    onClick={() => setShowUpcoming((v) => !v)}
                    className="w-full flex items-center gap-2 px-6 py-2.5 text-left hover:bg-amber-50"
                  >
                    <ChevronRight className={`w-4 h-4 text-amber-600 transition-transform ${showUpcoming ? 'rotate-90' : ''}`} />
                    <CalendarClock className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-900">
                      {upcoming.length} upcoming job{upcoming.length === 1 ? '' : 's'}
                    </span>
                    <span className="text-xs text-amber-700/80">
                      next: {formatDay(upcoming[0].scheduled_date)}
                    </span>
                  </button>
                  {showUpcoming && (
                    <div className="divide-y border-t bg-white">
                      {upcoming.map(renderRow)}
                    </div>
                  )}
                </div>
              )}
              {past.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-10">No past records for {displayName}.</p>
              ) : (
                <div className="divide-y">
                  {past.map(renderRow)}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
