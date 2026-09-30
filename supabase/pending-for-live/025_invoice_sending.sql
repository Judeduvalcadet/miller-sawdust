-- Invoice sending (email via Resend, SMS via Twilio).
-- Applied to the sandbox on 2026-09-30; run on production at go-live,
-- together with:
--   supabase secrets set RESEND_API_KEY=... INVOICE_FROM_EMAIL=invoices@millersawdust.app \
--     TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+1...
--   supabase functions deploy send-invoice
alter table invoices add column if not exists emailed_at timestamptz;
alter table invoices add column if not exists texted_at timestamptz;
-- Private bucket holding the sent PDF copies (links are signed, 30 days).
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
  on conflict (id) do nothing;
