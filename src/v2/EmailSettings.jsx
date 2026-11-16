import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/entities';
import { messaging } from './inbox/api';
import { V2_READ_ONLY } from './guard';
import EmailTemplateEditor from './EmailTemplateEditor';
import { emailIdentity } from '@/lib/emailIdentity';

export default function EmailSettings() {
  const [tab, setTab] = useState('templates');
  const [editingTemplate, setEditingTemplate] = useState(false);
  const query = useQuery({ queryKey: ['inbox', 'email-config'], queryFn: () => messaging('email_config'), retry: false });
  const config = query.data;
  const companyQuery = useQuery({ queryKey: ['settings'], queryFn: async () => (await base44.entities.Settings.list())[0] || null });
  const company = companyQuery.data?.company_profile || {};
  const identity = emailIdentity(company, config?.sender || '');
  const apiUrl = new URL(import.meta.env.VITE_SUPABASE_URL);
  const hosted = apiUrl.hostname.endsWith('.supabase.co');
  const configured = config?.api_key_configured && config?.sender_configured && config?.webhook_configured;
  const mode = !config ? 'Status unavailable' : config.dry_run ? 'Simulation mode' : !configured ? 'Setup incomplete' : V2_READ_ONLY ? 'App is read-only' : config.email_ready ? 'Connected' : 'Sending disabled';
  if (editingTemplate) return <div className="p-6 max-w-3xl"><EmailTemplateEditor editing onClose={() => setEditingTemplate(false)} /></div>;
  return <div className="p-6 max-w-3xl space-y-5">
    <div role="tablist" aria-label="Email settings" className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">{['templates', 'configuration'].map(key => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`px-4 py-2 text-sm rounded-lg ${tab === key ? 'bg-white shadow-sm text-gray-950' : 'text-gray-500'}`}>{key === 'templates' ? 'Templates' : 'Configuration'}</button>)}</div>
    {tab === 'templates' ? <EmailTemplateEditor onEdit={() => setEditingTemplate(true)} /> : <>
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-lg font-semibold text-gray-950">Email configuration</h2><p className="text-sm text-gray-500 mt-1">Invoice PDFs and customer emails are sent through Resend.</p></div>
      <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className={`w-4 h-4 mr-2 ${query.isFetching ? 'animate-spin' : ''}`} />Refresh status</Button>
    </div>
    <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex justify-between gap-3"><h3 className="font-semibold">Connection</h3><span className="text-xs rounded-full bg-gray-100 text-gray-700 px-3 py-1">{mode}</span></div>
      <dl className="text-sm grid sm:grid-cols-[140px_1fr] gap-2">
        <dt className="text-gray-500">Provider</dt><dd>Resend API</dd>
        <dt className="text-gray-500">Sender name</dt><dd>{identity.name || 'Not configured'}</dd>
        <dt className="text-gray-500">Reply-To</dt><dd>{identity.replyTo || 'Not configured'}</dd>
        <dt className="text-gray-500">Company address</dt><dd>{[company.street_address, [company.city, company.state, company.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Not set'}</dd>
        <dt className="text-gray-500">Company phone</dt><dd>{company.phone || 'Not set'}</dd>
        <dt className="text-gray-500">Backend sender</dt><dd className="break-all">{config?.sender || 'Not configured'}</dd>
        <dt className="text-gray-500">Environment</dt><dd>{hosted ? 'Hosted backend' : 'Local sandbox'}</dd>
      </dl>
      {query.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : query.isError ? <p role="alert" className="text-sm text-red-700">Could not read email configuration. {query.error.message}</p> : <ul className="space-y-2 text-sm">
        {[[config.api_key_configured, 'Resend API key saved'], [config.sender_configured, 'Sender address saved'], [config.webhook_configured, 'Delivery receipt verification']].map(([ready, label]) => <li key={label} className="flex items-center gap-2">{ready ? <CheckCircle2 className="w-4 h-4 text-green-700" /> : <Circle className="w-4 h-4 text-gray-400" />}{label}<span className="ml-auto text-xs text-gray-500">{ready ? 'Configured' : 'Missing'}</span></li>)}
      </ul>}
      {config && !config.webhook_configured && <p className="text-sm text-gray-600">Delivery tracking is not connected yet. Test emails can send, but automatic delivery and bounce updates need a public Resend webhook and its signing secret.</p>}
      <p className="text-xs text-gray-500">Configured means the credential is saved. Domain verification and successful delivery still need to be confirmed in Resend.</p>
    </section>
    </>}
  </div>;
}
