import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, History } from "lucide-react";
import {
  SECTIONS, HIDDEN_FIELDS, fieldLabel, formatTimestamp, formatValue,
} from '@/lib/job-history';

// Turn raw job_events rows + the job's own timestamp columns into per-section
// timeline entries. Events recorded before activity tracking went live don't
// exist, so known milestones (created / completed / invoice / payment) are
// synthesized from the job row itself when no matching event is present.
function buildSections(job, events) {
  const entries = []; // { ts, actor, sectionKey, lines: [..] }

  const sectionFor = (field) => {
    for (const s of SECTIONS) {
      if (s.fields && s.fields.has(field)) return s.key;
    }
    return 'details';
  };

  let hasCreatedEvent = false;
  const changedFields = new Set();

  for (const ev of events) {
    const actor = ev.actor_name || null;
    if (ev.event_type === 'created') {
      hasCreatedEvent = true;
      entries.push({ ts: ev.created_date, actor, sectionKey: 'lifecycle', lines: ['Job created'] });
      continue;
    }
    if (ev.event_type === 'deleted') {
      entries.push({ ts: ev.created_date, actor, sectionKey: 'lifecycle', lines: ['Job deleted'] });
      continue;
    }
    // updated: split this event's field changes across their sections
    const bySection = {};
    for (const [field, change] of Object.entries(ev.changes || {})) {
      if (HIDDEN_FIELDS.has(field)) continue;
      changedFields.add(field);
      const key = sectionFor(field);
      const line = `${fieldLabel(field)}: ${formatValue(field, change.from)} → ${formatValue(field, change.to)}`;
      ;(bySection[key] ??= []).push(line);
    }
    for (const [key, lines] of Object.entries(bySection)) {
      entries.push({ ts: ev.created_date, actor, sectionKey: key, lines });
    }
  }

  // Synthesized milestones for history that predates activity tracking
  if (!hasCreatedEvent && job.created_date) {
    entries.push({ ts: job.created_date, actor: null, sectionKey: 'lifecycle', lines: ['Job created'], synthesized: true });
  }
  const synth = (tsField, byField, sectionKey, label) => {
    if (job[tsField] && !changedFields.has(tsField)) {
      entries.push({
        ts: job[tsField], actor: byField ? job[byField] : null, sectionKey,
        lines: [label], synthesized: true,
      });
    }
  };
  synth('completed_at', null, 'delivery', 'Marked completed');
  synth('invoice_marked_at', 'invoice_marked_by', 'invoicing', 'Invoice marked sent');
  synth('payment_marked_at', 'payment_marked_by', 'invoicing', 'Payment marked collected');

  const sections = SECTIONS.map((s) => ({
    ...s,
    entries: entries
      .filter((e) => e.sectionKey === s.key)
      .sort((a, b) => new Date(b.ts) - new Date(a.ts)),
  })).filter((s) => s.entries.length > 0);

  return sections;
}

export default function JobActivityPanel({ job, open, onClose }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['job-events', job?.id],
    enabled: open && !!job?.id,
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

  if (!job) return null;
  const sections = isLoading ? [] : buildSections(job, events);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-amber-600" />
            Job Activity
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-gray-500 -mt-2">
          {job.customer_company_name || job.location_name || 'Job'} — created {formatTimestamp(job.created_date)}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
          </div>
        ) : (
          <div className="space-y-5">
            {sections.map((section) => (
              <div key={section.key}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 border-b pb-1 mb-2">
                  {section.title}
                </h3>
                <div className="space-y-3">
                  {section.entries.map((entry, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-1.5 mt-1.5 shrink-0">
                        <div className={`w-1.5 h-1.5 rounded-full ${entry.synthesized ? 'bg-gray-300' : 'bg-amber-500'}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">
                          {formatTimestamp(entry.ts)}
                          {entry.actor && <span className="text-gray-700 font-medium"> · {entry.actor}</span>}
                        </div>
                        {entry.lines.map((line, j) => (
                          <div key={j} className="text-sm text-gray-800">{line}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {sections.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">No recorded activity for this job yet.</p>
            )}
            <p className="text-[11px] text-gray-400 pt-2 border-t">
              Detailed change tracking began July 27, 2026. Earlier jobs show only their known milestones.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
