-- Durable receipt only. Sync workers consume these records separately.
create table if not exists public.qb_webhook_events (
  event_key text primary key,
  realm_id text not null,
  entity_name text not null,
  entity_id text not null,
  operation text not null,
  source_updated_at timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.qb_webhook_events enable row level security;
revoke all on public.qb_webhook_events from anon, authenticated;
grant all on public.qb_webhook_events to service_role;
