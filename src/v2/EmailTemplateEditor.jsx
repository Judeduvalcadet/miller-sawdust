import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/entities';
import { messaging } from './inbox/api';
import { V2_READ_ONLY } from './guard';
import { getTokenClaim } from '@/api/authClient';
import { DEFAULT_EMAIL_TEMPLATE, EMAIL_VARIABLES, companyEmailValues, renderEmailTemplate, validateEmailTemplate } from '../../supabase/functions/_shared/email-template';

const SAMPLE = { company_name: 'Miller Sawdust', customer_name: 'Sample Farm', invoice_number: '10482', invoice_date: 'Oct 2, 2026', due_date: 'Nov 1, 2026', invoice_total: '$400.00', invoice_balance: '$400.00', company_email: 'office@example.com' };

export default function EmailTemplateEditor({ editing = false, onEdit, onClose }) {
  const qc = useQueryClient();
  const companyQuery = useQuery({ queryKey: ['settings'], queryFn: async () => (await base44.entities.Settings.list())[0] || null });
  const query = useQuery({ queryKey: ['email-template'], queryFn: () => messaging('email_template'), retry: false });
  const [draft, setDraft] = useState(null);
  const [active, setActive] = useState('body');
  const [saved, setSaved] = useState(false);
  const refs = { subject: useRef(null), body: useRef(null) };
  const template = draft || query.data?.template || DEFAULT_EMAIL_TEMPLATE;
  const editable = !V2_READ_ONLY && getTokenClaim('app_role') === 'admin' && query.isSuccess;
  let preview, error;
  try { preview = renderEmailTemplate(template, { ...SAMPLE, ...companyEmailValues(companyQuery.data?.company_profile) }); } catch (e) { error = e.message; }
  const save = useMutation({
    mutationFn: () => messaging('save_email_template', { template: validateEmailTemplate(template) }),
    onSuccess: (data) => { qc.setQueryData(['email-template'], data); setDraft(null); setSaved(true); onClose?.(); },
  });
  function change(field, value) { setDraft({ ...template, [field]: value }); setSaved(false); save.reset(); }
  function insert(variable) {
    const el = refs[active].current;
    const start = el?.selectionStart ?? template[active].length;
    const end = el?.selectionEnd ?? start;
    const token = `{{${variable}}}`;
    change(active, template[active].slice(0, start) + token + template[active].slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  }
  if (!editing) return <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
    <div className="flex items-center justify-between gap-4"><h3 className="font-semibold text-gray-950">Invoice email template</h3><Button variant="outline" disabled={!editable} onClick={onEdit}>Edit</Button></div>
    <p className="text-sm text-gray-500">The invoice PDF is attached automatically. Variables are filled in for each invoice.</p>
    {query.isPending ? <p className="text-sm text-gray-500">Loading template...</p> : query.isError ? <p role="alert" className="text-sm text-red-700">Could not load the saved template. <button className="underline" onClick={() => query.refetch()}>Retry</button></p> : <>
      <div><p className="text-xs text-gray-500 mb-1">Subject</p><p className="text-sm font-medium break-words">{template.subject}</p></div>
      <div><p className="text-xs text-gray-500 mb-1">Message</p><p className="text-sm whitespace-pre-wrap break-words">{template.body}</p></div>
    </>}
  </section>;
  return <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
    <Button variant="ghost" disabled={save.isPending} onClick={onClose}>Back to email settings</Button>
    <div><h3 className="font-semibold text-gray-950">Edit invoice email template</h3><p className="text-sm text-gray-500 mt-1">Edit the subject and message. The invoice PDF is attached automatically. This template does not change SMS or the PDF layout.</p></div>
    {query.isPending && <p className="text-sm text-gray-500">Loading template...</p>}
    {query.isError && <p role="alert" className="text-sm text-red-700">Could not load the saved template. <button className="underline" onClick={() => query.refetch()}>Retry</button></p>}
    <div><label htmlFor="invoice-email-subject" className="block text-sm font-medium mb-1">Subject</label><input id="invoice-email-subject" ref={refs.subject} value={template.subject} disabled={!editable || save.isPending} onFocus={() => setActive('subject')} onChange={e => change('subject', e.target.value)} maxLength={200} className="w-full rounded-lg border border-gray-200 p-3 text-sm disabled:bg-gray-50" /></div>
    <div><label htmlFor="invoice-email-body" className="block text-sm font-medium mb-1">Message</label><textarea id="invoice-email-body" ref={refs.body} value={template.body} disabled={!editable || save.isPending} onFocus={() => setActive('body')} onChange={e => change('body', e.target.value)} maxLength={10000} rows={8} className="w-full rounded-lg border border-gray-200 p-3 text-sm disabled:bg-gray-50" /></div>
    <div><p className="text-xs text-gray-500 mb-2">Insert a variable into the {active === 'subject' ? 'subject' : 'message'} at the cursor:</p><div className="flex flex-wrap gap-2">{EMAIL_VARIABLES.map(key => <button key={key} type="button" disabled={!editable || save.isPending} onMouseDown={e => e.preventDefault()} onClick={() => insert(key)} className="text-xs rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 hover:bg-gray-100 disabled:opacity-50">{`{{${key}}}`}</button>)}</div></div>
    {(error || save.error) && <p role="alert" className="text-sm text-red-700">{error || save.error.message}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={!editable || !draft || !!error || save.isPending} onClick={() => save.mutate()} className="bg-gray-950 hover:bg-gray-800">{save.isPending ? 'Saving...' : 'Save template'}</Button>
      <Button variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button>
      <Button variant="outline" disabled={!editable || save.isPending} onClick={() => { setDraft({ ...DEFAULT_EMAIL_TEMPLATE }); setSaved(false); save.reset(); }}>Use default</Button>
      {saved && <span role="status" className="text-sm text-green-700">Template saved</span>}
      {!V2_READ_ONLY && query.isSuccess && !editable && <p className="text-xs text-gray-500">An administrator can edit this template.</p>}
      {V2_READ_ONLY && <p className="text-xs text-gray-500">Editing is available in the local sandbox.</p>}
    </div>
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3"><p className="text-xs uppercase tracking-wide text-gray-500">Preview with sample data</p>{preview ? <><p className="font-semibold text-sm break-words">{preview.subject}</p><p className="text-sm whitespace-pre-wrap break-words">{preview.body}</p><div className="inline-block text-xs bg-white rounded-lg border border-gray-200 px-3 py-2">Invoice 10482.pdf</div></> : <p className="text-sm text-gray-500">Fix the template errors to see the preview.</p>}</div>
  </section>;
}
