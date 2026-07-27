import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Loader2 } from "lucide-react";
import { HIDDEN_FIELDS, fieldLabel, formatTimestamp, formatValue } from '@/lib/job-history';

// Flat activity timeline rendered inline (no dialog of its own). Each row:
// [tag] what changed | who did it · when. Newest first.

const TAG_META = {
  create: { label: 'Create', cls: 'bg-green-100 text-green-700' },
  schedule: { label: 'Schedule', cls: 'bg-purple-100 text-purple-700' },
  driver: { label: 'Driver', cls: 'bg-blue-100 text-blue-700' },
  status: { label: 'Status', cls: 'bg-sky-100 text-sky-700' },
  invoice: { label: 'Invoice', cls: 'bg-emerald-100 text-emerald-700' },
  edit: { label: 'Edit', cls: 'bg-amber-100 text-amber-700' },
  delete: { label: 'Delete', cls: 'bg-red-100 text-red-700' },
};

function tagFor(field) {
  if (field === 'scheduled_date') return 'schedule';
  if (field === 'assigned_driver_name' || field === 'assigned_driver_pickup_role') return 'driver';
  if (field === 'status' || field === 'completed_at' || field === 'yards_collected' || field === 'driver_notes') return 'status';
  if (field.startsWith('invoice') || field.startsWith('payment')) return 'invoice';
  return 'edit';
}

// Events + the job's own timestamp columns → flat entries, newest first.
// Milestones that predate activity tracking are synthesized from the job row.
function buildEntries(job, events) {
  const entries = []; // { ts, actor, tag, lines, synthesized }
  let hasCreatedEvent = false;
  const changedFields = new Set();

  for (const ev of events) {
    const actor = ev.actor_name || null;
    if (ev.event_type === 'created') {
      hasCreatedEvent = true;
      entries.push({ ts: ev.created_date, actor, tag: 'create', lines: ['Job created'] });
      continue;
    }
    if (ev.event_type === 'deleted') {
      entries.push({ ts: ev.created_date, actor, tag: 'delete', lines: ['Job deleted'] });
      continue;
    }
    const byTag = {};
    for (const [field, change] of Object.entries(ev.changes || {})) {
      if (HIDDEN_FIELDS.has(field)) continue;
      changedFields.add(field);
      const line = `${fieldLabel(field)}: ${formatValue(field, change.from)} → ${formatValue(field, change.to)}`;
      ;(byTag[tagFor(field)] ??= []).push(line);
    }
    for (const [tag, lines] of Object.entries(byTag)) {
      entries.push({ ts: ev.created_date, actor, tag, lines });
    }
  }

  if (!hasCreatedEvent && job.created_date) {
    entries.push({ ts: job.created_date, actor: null, tag: 'create', lines: ['Job created'], synthesized: true });
  }
  const synth = (tsField, byField, tag, label) => {
    if (job[tsField] && !changedFields.has(tsField)) {
      entries.push({ ts: job[tsField], actor: byField ? job[byField] : null, tag, lines: [label], synthesized: true });
    }
  };
  synth('completed_at', null, 'status', 'Marked completed');
  synth('invoice_marked_at', 'invoice_marked_by', 'invoice', 'Invoice marked sent');
  synth('payment_marked_at', 'payment_marked_by', 'invoice', 'Payment marked collected');

  return entries.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

export default function JobActivityTimeline({ job }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['job-events', job?.id],
    enabled: !!job?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_events')
        .select('*')
        .eq('job_id', job.id)
        .order('created_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  if (!job?.id) return null;

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
      </div>
    );
  }

  const entries = buildEntries(job, events);

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Job Activity</h3>
      <div className="divide-y divide-gray-100">
        {entries.map((entry, i) => {
          const tag = TAG_META[entry.tag] || TAG_META.edit;
          return (
            <div key={i} className="flex items-start gap-3 py-2.5">
              <span className={`shrink-0 w-20 text-center text-[11px] font-semibold rounded-full px-2 py-0.5 mt-0.5 ${tag.cls}`}>
                {tag.label}
              </span>
              <div className="flex-1 min-w-0">
                {entry.lines.map((line, j) => (
                  <div key={j} className="text-sm text-gray-800 break-words">{line}</div>
                ))}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-medium text-gray-700">{entry.actor || '—'}</div>
                <div className="text-[11px] text-gray-400 whitespace-nowrap">{formatTimestamp(entry.ts)}</div>
              </div>
            </div>
          );
        })}
        {entries.length === 0 && (
          <p className="text-sm text-gray-500 py-3 text-center">No recorded activity for this job yet.</p>
        )}
      </div>
      <p className="text-[11px] text-gray-400 pt-2 border-t mt-1">
        Detailed change tracking began July 27, 2026. Earlier jobs show only their known milestones.
      </p>
    </div>
  );
}
