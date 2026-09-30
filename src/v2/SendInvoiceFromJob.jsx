import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Eye, Mail, MessageSquareText, Check } from 'lucide-react';
import { base44 } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { cn } from '@/lib/utils';
import { InvoiceComposer } from './V2Invoices';
import InvoicePreview from './InvoicePreview';
import { ensureInvertedLogo } from './InvoicePreview';
import { buildInvoicePdfBase64 } from './invoicePdf';

// "Send Invoice" straight from a dispatch job card, at any job status: the
// full line-item composer on top (same one the Create tab uses), a preview,
// and SMS / Email boxes below. Sending creates the invoice first if the job
// doesn't have one yet (or saves edits to the one it has), then goes through
// the send-invoice function.

const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function SendInvoiceFromJob({ job, customer, onClose, onSent }) {
  const queryClient = useQueryClient();
  const composerApi = useRef(null);
  const [previewInv, setPreviewInv] = useState(null);
  const [busy, setBusy] = useState(null); // 'sms' | 'email' | 'email_save'
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // { mode, to, dry_run }
  const [phone, setPhone] = useState(customer?.phone || '');
  const [email, setEmail] = useState(customer?.email || '');

  const { data: items } = useQuery({
    queryKey: ['items'],
    queryFn: () => base44.entities.Item.list('sort_order'),
    staleTime: 300000,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await base44.entities.Settings.list())[0] || null,
    staleTime: 300000,
  });
  const { data: existingInv } = useQuery({
    queryKey: ['job-invoice', job.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase.from('invoices')
        .select('*').eq('job_id', job.id).limit(1);
      if (qErr) throw qErr;
      return data?.[0] || null;
    },
  });

  const company = settings?.company_profile;
  const newEmailTyped = email.trim() && email.trim().toLowerCase() !== (customer?.email || '').trim().toLowerCase();

  const draftInvoice = (payload) => ({
    ...(existingInv || {}),
    doc_number: existingInv?.doc_number || '—',
    customer_id: job.customer_id,
    job_id: job.id,
    txn_date: existingInv?.txn_date || job.scheduled_date,
    due_date: existingInv?.due_date || addDays(job.scheduled_date, 30),
    status: existingInv?.status || 'open',
    lines: payload.lines,
    total: payload.total,
    balance: existingInv?.status === 'paid' ? 0 : payload.total,
    note: payload.note,
  });

  const openPreview = () => {
    const api = composerApi.current;
    if (!api?.ready) return;
    setPreviewInv(draftInvoice(api.getPayload()));
  };

  // Create the invoice if the job has none, or save the composer's current
  // lines onto the one it has; returns the up-to-date invoice row.
  const ensureInvoice = async (payload) => {
    if (existingInv) {
      const patch = {
        lines: payload.lines,
        total: payload.total,
        balance: existingInv.status === 'paid' ? 0 : payload.total,
        note: payload.note,
        edited_at: new Date().toISOString(),
      };
      const updated = await base44.entities.Invoice.update(existingInv.id, patch);
      return { ...existingInv, ...patch, ...(updated || {}) };
    }
    const { data: num, error: numErr } = await supabase.rpc('next_invoice_number');
    if (numErr) throw numErr;
    const created = await base44.entities.Invoice.create({
      customer_id: job.customer_id,
      job_id: job.id,
      doc_number: num,
      txn_date: job.scheduled_date,
      due_date: addDays(job.scheduled_date, 30),
      total: payload.total,
      balance: payload.total,
      status: 'open',
      lines: payload.lines,
      source: 'app',
      note: payload.note,
    });
    return created;
  };

  const send = async (mode, { saveEmail = false } = {}) => {
    const api = composerApi.current;
    if (!api?.ready) return;
    const to = mode === 'sms' ? phone.trim() : email.trim();
    if (!to) { setError(mode === 'sms' ? 'Enter a phone number first.' : 'Enter an email address first.'); return; }
    setBusy(saveEmail ? 'email_save' : mode);
    setError('');
    try {
      const payload = api.getPayload();
      if (payload.total <= 0) throw new Error('The invoice total is zero — pick the items first.');
      if (saveEmail && job.customer_id) {
        await base44.entities.Customer.update(job.customer_id, { email: to });
        queryClient.invalidateQueries({ queryKey: ['v2-customers'] });
      }
      const invoice = await ensureInvoice(payload);
      const logo = await ensureInvertedLogo();
      const pdf_base64 = await buildInvoicePdfBase64({ invoice, customer, company, logo });
      const { data, error: fnErr } = await supabase.functions.invoke('send-invoice', {
        body: {
          invoice_id: invoice.id,
          mode,
          to,
          pdf_base64,
          filename: `Invoice ${invoice.doc_number || ''}.pdf`.replace('  ', ' '),
        },
      });
      if (fnErr) {
        let msg = fnErr.message || 'Send failed';
        try {
          const j = await fnErr.context.json();
          if (j?.error === 'not_configured') msg = `Sending isn’t configured yet (missing: ${(j.missing || []).join(', ')})`;
          else if (j?.error) msg = j.detail ? `${j.error}: ${j.detail}` : j.error;
        } catch { /* keep generic */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      queryClient.invalidateQueries({ queryKey: ['sent-invoice-job-ids'] });
      queryClient.invalidateQueries({ queryKey: ['job-invoice', job.id] });
      queryClient.invalidateQueries({ queryKey: ['v2-invoices'] });
      setDone({ mode, to, dry_run: !!data?.dry_run });
      onSent?.();
    } catch (e) {
      setError(e.message || 'Send failed');
    } finally {
      setBusy(null);
    }
  };

  const customerName = (customer?.company_name || customer?.name || job.location_name || '').trim();

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Send invoice — {customerName}
              {existingInv?.doc_number ? <span className="text-gray-400 font-normal"> · #{existingInv.doc_number}</span> : null}
            </DialogTitle>
          </DialogHeader>

          {done ? (
            <div className="py-3">
              <p className="text-sm text-gray-800 flex items-center gap-2">
                <span className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center shrink-0"><Check className="w-4 h-4 text-white" /></span>
                Invoice {done.mode === 'sms' ? 'texted' : 'emailed'} to {done.to}.
              </p>
              {done.dry_run && (
                <p className="text-xs text-gray-500 mt-2">
                  Sandbox dry run — everything was prepared and stamped, but no real message left this machine.
                </p>
              )}
              <div className="flex justify-end mt-4">
                <Button className="bg-gray-950 hover:bg-gray-800" onClick={onClose}>Close</Button>
              </div>
            </div>
          ) : (
            <>
              {/* Line items — the same composer as the Create tab, footer hidden */}
              <div className="-mx-6 -my-2">
                {items ? (
                  <InvoiceComposer
                    job={job}
                    items={items}
                    initial={existingInv || null}
                    isBatch={false}
                    hideFooter
                    exposeApi={(api) => { composerApi.current = api; }}
                    onCancel={() => {}}
                    onCreated={() => {}}
                  />
                ) : (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" className="h-8" onClick={openPreview}>
                  <Eye className="w-4 h-4 mr-1.5" /> Preview
                </Button>
                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>

              {/* SMS + Email boxes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                    <MessageSquareText className="w-3.5 h-3.5" /> SMS
                  </p>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={customer?.phone ? '' : 'No phone on file — type one'}
                    className="mt-2"
                  />
                  <p className="text-[11px] text-gray-400 mt-1.5">They receive the invoice PDF itself by MMS.</p>
                  <Button
                    size="sm"
                    className="mt-2.5 bg-gray-950 hover:bg-gray-800 w-full"
                    disabled={!!busy || !phone.trim()}
                    onClick={() => send('sms')}
                  >
                    {busy === 'sms' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Send via SMS
                  </Button>
                </div>

                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> Email
                  </p>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={customer?.email ? '' : 'No email for this customer — type one'}
                    className="mt-2"
                  />
                  <p className="text-[11px] text-gray-400 mt-1.5">The PDF is attached, plus a 30-day backup link.</p>
                  <div className={cn('mt-2.5 grid gap-2', newEmailTyped ? 'grid-cols-2' : 'grid-cols-1')}>
                    <Button
                      size="sm"
                      className="bg-gray-950 hover:bg-gray-800 w-full"
                      disabled={!!busy || !email.trim()}
                      onClick={() => send('email')}
                    >
                      {busy === 'email' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Send via Email
                    </Button>
                    {newEmailTyped && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={!!busy}
                        onClick={() => send('email', { saveEmail: true })}
                        title="Adds this email to the customer record, then sends"
                      >
                        {busy === 'email_save' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Save email + Send
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <InvoicePreview
        open={!!previewInv}
        onClose={() => setPreviewInv(null)}
        invoice={previewInv}
        customer={customer}
        company={company}
      />
    </>
  );
}
