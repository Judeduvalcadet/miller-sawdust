import { validContact } from '@/lib/contactValidation';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { snapshotAddress } from '@/lib/invoiceBilling';
import CustomerBilling from './CustomerBilling';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Loader2, Eye, Mail, MessageSquareText, Check } from 'lucide-react';
import { base44 } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { cn } from '@/lib/utils';
import { InvoiceComposer } from './V2Invoices';
import InvoicePreview from './InvoicePreview';
import { ensureInvertedLogo } from './InvoicePreview';
import { buildInvoicePdfBase64 } from './invoicePdf';
import { assertV2Writable } from './guard';
import { checkSendResult, STATUS_LABELS } from './inbox/api';

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
  const billingApi = useRef(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [channel, setChannel] = useState('sms');
  const [saveEmail, setSaveEmail] = useState(false);
  const sendRequests = useRef({});
  const sending = useRef(false);
  const preparedInvoice = useRef(null);
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
  const { data: existingInv, isPending: invoiceLoading, isError: invoiceLoadError } = useQuery({
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

  const getPayload = () => {
    if (!composerApi.current?.ready || !billingApi.current?.ready) throw new Error('Wait for the invoice and billing details to load.');
    return {...composerApi.current.getPayload({includeBilling:false}), ...billingApi.current.getPayload()};
  };

  const draftInvoice = (payload) => ({
    ...(existingInv || {}),
    doc_number: existingInv?.doc_number || '-',
    customer_id: job.customer_id,
    job_id: job.id,
    txn_date: existingInv?.txn_date || job.scheduled_date,
    due_date: existingInv?.due_date || addDays(job.scheduled_date, 30),
    status: existingInv?.status || 'open',
    lines: payload.lines,
    total: payload.total,
    balance: existingInv?.status === 'paid' ? 0 : Math.max(0,payload.total-(Number(existingInv?.total||0)-Number(existingInv?.balance??existingInv?.total??0))),
    note: payload.note,
    billing_address: payload.billing_address,
    billing_customer_id: payload.billing_customer_id,
    billing_mode: payload.billing_mode,
  });

  const openPreview = () => {
    const api = composerApi.current;
    if (!api?.ready) { setError('Wait for the invoice details to load.'); return; }
    try { setPreviewInv(draftInvoice(getPayload())); } catch (e) { setError(e.message); }
  };

  // Create the invoice if the job has none, or save the composer's current
  // lines onto the one it has; returns the up-to-date invoice row.
  const ensureInvoice = async (payload) => {
    assertV2Writable();
    if (invoiceLoading || invoiceLoadError) throw new Error('Wait for the existing invoice to load before sending.');
    if (preparedInvoice.current) {
      if (JSON.stringify(payload) !== preparedInvoice.current.payloadKey) {
        throw new Error('This invoice was already prepared. Close and reopen it to edit before sending again.');
      }
      return preparedInvoice.current.invoice;
    }
    if (existingInv) {
      const patch = {
        lines: payload.lines,
        total: payload.total,
        balance: existingInv.status === 'paid' ? 0 : Math.max(0,payload.total-(Number(existingInv.total)-Number(existingInv.balance??existingInv.total))),
        note: payload.note,
        billing_address: payload.billing_address,
        billing_customer_id: payload.billing_customer_id,
        billing_mode: payload.billing_mode,
        edited_at: new Date().toISOString(),
      };
      const updated = await base44.entities.Invoice.update(existingInv.id, patch);
      const invoice = { ...existingInv, ...patch, ...(updated || {}) };
      preparedInvoice.current = { invoice, payloadKey: JSON.stringify(payload) };
      return invoice;
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
      billing_address: payload.billing_address,
      billing_customer_id: payload.billing_customer_id,
      billing_mode: payload.billing_mode,
    });
    preparedInvoice.current = { invoice: created, payloadKey: JSON.stringify(payload) };
    queryClient.setQueryData(['job-invoice', job.id], created);
    return created;
  };

  const send = async (mode, { saveEmail = false } = {}) => {
    if (sending.current) return;
    const api = composerApi.current;
    if (!api?.ready) { setError('Wait for the invoice details to load.'); return; }
    const to = mode === 'sms' ? phone.trim() : email.trim();
    if (!validContact(mode === 'sms' ? 'tel' : 'email', to)) { setError(mode === 'sms' ? 'Enter a complete phone number.' : 'Enter a valid email address.'); return; }
    sending.current = true;
    setBusy(saveEmail ? 'email_save' : mode);
    setError('');
    try {
      assertV2Writable();
      const payload = getPayload();
      if (preparedInvoice.current && JSON.stringify(payload) !== preparedInvoice.current.payloadKey) throw new Error('This invoice was already prepared. Close and reopen it to edit before sending again.');
      if (payload.total <= 0) throw new Error('The invoice total is zero - pick the items first.');
      await billingApi.current.saveIfDirty();
      if (saveEmail && job.customer_id) {
        await base44.entities.Customer.update(job.customer_id, { email: to });
        queryClient.invalidateQueries({ queryKey: ['v2-customers'] });
      }
      const invoice = await ensureInvoice(payload);
      billingApi.current.useSnapshot(payload);
      await queryClient.invalidateQueries({ queryKey: ['customer-prices'] });
      const logo = await ensureInvertedLogo();
      const pdf_base64 = await buildInvoicePdfBase64({ invoice, customer, company, logo });
      const { data, error: fnErr } = await supabase.functions.invoke('send-invoice', {
        body: {
          invoice_id: invoice.id,
          request_id: sendRequests.current[`${mode}:${to}`] ||= crypto.randomUUID(),
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
          else if (j?.message) msg = j.message;
        } catch { /* keep generic */ }
        throw new Error(msg);
      }
      checkSendResult(data);
      queryClient.invalidateQueries({ queryKey: ['sent-invoice-job-ids'] });
      queryClient.invalidateQueries({ queryKey: ['job-invoice', job.id] });
      queryClient.invalidateQueries({ queryKey: ['v2-invoices'] });
      setDone({ mode, to, dry_run: !!data?.dry_run, status: data.message.status });
      onSent?.();
    } catch (e) {
      setError(e.message || 'Send failed');
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };

  const customerName = (customer?.company_name || customer?.name || job.location_name || '').trim();

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o && !busy && !billingBusy) onClose(); }}>
        <DialogContent className={cn("max-h-[92vh] overflow-y-auto", done ? "w-fit max-w-[calc(100vw-2rem)] sm:max-w-md" : "max-w-5xl")}>
          <DialogHeader>
            <DialogTitle>
              Send invoice, {customerName}
              {existingInv?.doc_number ? <span className="text-gray-400 font-normal"> · #{existingInv.doc_number}</span> : null}
            </DialogTitle>
          </DialogHeader>

          {done ? (
            <div className="py-3">
              <p className="text-sm text-gray-800 flex items-center gap-2">
                <span className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center shrink-0"><Check className="w-4 h-4 text-white" /></span>
                {STATUS_LABELS[done.status] || 'Queued'} · {done.to}.
              </p>
              {done.dry_run && (
                <p className="text-xs text-gray-500 mt-2">
                  Simulation only. No message was sent and the invoice was not marked sent.
                </p>
              )}
              <div className="flex justify-end mt-4">
                <Button className="bg-gray-950 hover:bg-gray-800" onClick={onClose}>Close</Button>
              </div>
            </div>
          ) : (
            <>
              {/* Line items - the same composer as the Create tab, footer hidden */}
              <fieldset disabled={!!busy || billingBusy} className="-mx-6 -my-2 min-w-0">
                {items && !invoiceLoading && !invoiceLoadError ? (
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
              </fieldset>

              <fieldset disabled={!!busy} className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
                <section className="border border-gray-200 rounded-xl min-w-0">
                  <h3 className="px-5 pt-4 text-sm font-semibold text-gray-900">Billing address</h3>
                  {customer && !invoiceLoading && !invoiceLoadError ? <CustomerBilling
                    customer={customer}
                    job={job}
                    initialPreference={existingInv ? {
                      mode:existingInv.billing_mode || 'address', customer_id:existingInv.billing_customer_id,
                      address:existingInv.billing_address || existingInv.qb_bill_to || snapshotAddress(customer), unchanged:true,
                    } : undefined}
                    disabled={!!busy}
                    onBusyChange={setBillingBusy}
                    exposeApi={api => { billingApi.current = api; }}
                  /> : <p className="p-5 text-sm text-gray-500">{invoiceLoadError || !customer ? 'Could not load the customer or invoice.' : 'Loading billing details...'}</p>}
                </section>
                <section className="border border-gray-200 rounded-xl min-w-0">
                  <div role="tablist" aria-label="Delivery method" className="flex border-b border-gray-100 px-3">
                    {[['sms','SMS',MessageSquareText],['email','Email',Mail]].map(([mode,label,Icon]) => <button key={mode} type="button" role="tab" aria-selected={channel === mode} aria-controls="invoice-delivery-panel" id={`invoice-${mode}-tab`} onClick={() => {setChannel(mode);setError('');}} className={cn('inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2', channel === mode ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500')}><Icon className="w-4 h-4" />{label}</button>)}
                  </div>
                  <div role="tabpanel" id="invoice-delivery-panel" aria-labelledby={`invoice-${channel}-tab`} className="p-4 space-y-3">
                    <p className="text-sm font-medium text-gray-900">{customerName}</p>
                    {channel === 'sms' ? <>
                      <Input aria-label="SMS phone number" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Enter a 10-digit phone number" />
                      <p className="text-xs text-gray-500">Invoice PDF attached by MMS.</p>
                    </> : <>
                      <Input aria-label="Invoice email address" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter an email address" />
                      <p className="text-xs text-gray-500">Invoice PDF attached.</p>
                      {newEmailTyped && <label className="flex items-center gap-2 text-xs text-gray-600"><Checkbox checked={saveEmail} onCheckedChange={v => setSaveEmail(v === true)} className="border-gray-300 data-[state=checked]:bg-gray-950 data-[state=checked]:text-white" />Save email to customer</label>}
                    </>}
                  </div>
                </section>
              </fieldset>
              {(error || invoiceLoadError) && <p role="alert" className="text-sm text-red-600">{error || 'Could not load the existing invoice. Close and try again.'}</p>}
              <div className="flex justify-end flex-wrap gap-2 border-t border-gray-100 pt-4">
                <Button variant="outline" disabled={!!busy || billingBusy} onClick={onClose}>Cancel</Button>
                <Button variant="outline" disabled={!!busy || billingBusy || invoiceLoading || invoiceLoadError || !customer || !items} onClick={openPreview}><Eye className="w-4 h-4" />Preview</Button>
                <Button className="bg-gray-950 hover:bg-gray-800" disabled={!!busy || billingBusy || invoiceLoading || invoiceLoadError || !customer || !items || !validContact(channel === 'sms' ? 'tel' : 'email', channel === 'sms' ? phone : email)} onClick={() => send(channel,{saveEmail:channel === 'email' && saveEmail && newEmailTyped})}>
                  {!!busy && <Loader2 className="w-4 h-4 animate-spin" />}Send via {channel === 'sms' ? 'SMS' : 'email'}
                </Button>
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
