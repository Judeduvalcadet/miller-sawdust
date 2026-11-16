begin;
create table public.email_gateway_receipts (
  event_id text primary key,
  sender_domain text not null,
  email_id text not null,
  event_type text not null check (event_type in ('email.sent','email.delivered','email.bounced','email.complained','email.failed')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index email_gateway_pending on public.email_gateway_receipts(received_at) where delivered_at is null;
alter table public.email_gateway_receipts enable row level security;
revoke all on public.email_gateway_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.email_gateway_receipts to service_role;
commit;
