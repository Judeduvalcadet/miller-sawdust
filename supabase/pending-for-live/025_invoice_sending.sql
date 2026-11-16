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

-- Communication log: one row per send, shown in the invoice's
-- Communication box. Written only by the send-invoice function.
create table if not exists invoice_sends (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  mode text not null check (mode in ('email','mms')),
  recipient text not null,
  storage_path text,
  dry_run boolean not null default false,
  sent_by text,
  created_date timestamptz not null default now()
);
create index if not exists invoice_sends_invoice_idx on invoice_sends(invoice_id);
alter table invoice_sends enable row level security;
create policy invoice_sends_select on invoice_sends for select
  using (app_role() = any (array['admin'::text,'assistant'::text]));
