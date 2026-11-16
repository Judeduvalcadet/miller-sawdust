-- ============================================================================
-- 014_quickbooks.sql — QuickBooks Online connection state + operation log.
-- Modeled on the proven trail-plumbing integration: a singleton token row
-- readable only by the service role, and a log every QB function writes to
-- (with a health panel reading it, unlike the reference app).
-- ============================================================================

create table qb_tokens (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  company_name text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exactly one connected company, ever.
create unique index qb_tokens_singleton on qb_tokens ((true));

-- Service-role only: RLS on with no policies.
alter table qb_tokens enable row level security;

create table qb_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  status text not null,           -- 'ok' | 'error' | 'warning'
  message text,
  details jsonb,
  created_date timestamptz not null default now()
);

alter table qb_logs enable row level security;

-- QBO entity mapping columns (filled by the read sync in Phase A)
alter table customers
  add column qb_id text,
  add column qb_sync_token text,
  add column qb_last_synced_at timestamptz;

create unique index customers_qb_id_unique on customers (qb_id) where qb_id is not null;
