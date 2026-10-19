-- This separate sandbox project stores notification IDs only, never OAuth tokens,
-- customer addresses, invoice contents, or copies of a production database.
create table public.qb_gateway_clients (
  realm_id text primary key,
  label text not null,
  key_sha256 text unique not null,
  enabled boolean not null default true,
  environment text not null default 'sandbox' check(environment='sandbox')
);
create table public.qb_gateway_events (
  event_key text primary key,
  realm_id text not null,
  entity_name text not null,
  entity_id text not null,
  operation text not null,
  source_updated_at timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index gateway_pending on public.qb_gateway_events(realm_id,received_at) where delivered_at is null;
alter table public.qb_gateway_clients enable row level security;
alter table public.qb_gateway_events enable row level security;
revoke all on public.qb_gateway_clients,public.qb_gateway_events from public,anon,authenticated;
grant all on public.qb_gateway_clients,public.qb_gateway_events to service_role;
