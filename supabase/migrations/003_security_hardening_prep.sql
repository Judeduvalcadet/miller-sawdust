-- ============================================================================
-- 003_security_hardening_prep.sql — ADDITIVE ONLY. Safe to apply while the
-- app is live: nothing here changes what existing clients can do.
-- Server-side auth prep: credentials table, rate limiting, session refresh
-- tokens, JWT claim helpers, anon login roster, wallboard role.
-- The enforcement flip lives in supabase/pending/004_enforce_rls.sql.
-- ============================================================================

-- =========================
-- 1. Driver credentials
-- =========================
-- RLS enabled with NO policies: only the service role (edge functions) can
-- ever read or write PIN hashes. The legacy drivers.pin_hash column stays
-- until 004 so old clients keep working during the transition.
create table driver_credentials (
  driver_id uuid primary key references drivers(id) on delete cascade,
  pin_bcrypt text not null,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);
alter table driver_credentials enable row level security;

create trigger trg_driver_credentials_updated_date
  before update on driver_credentials
  for each row execute function update_updated_date();

-- =========================
-- 2. Login attempts (rate limiting)
-- =========================
create table login_attempts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references drivers(id) on delete cascade,
  ip text,
  success boolean not null default false,
  attempted_at timestamptz not null default now()
);
alter table login_attempts enable row level security;
create index idx_login_attempts_driver_time on login_attempts(driver_id, attempted_at);

-- =========================
-- 3. Session refresh tokens
-- =========================
-- Sessions store a SHA-256 of their refresh token. Legacy sessions created by
-- the old client have NULL here until the device exchanges them for a token.
alter table driver_sessions add column token_hash text;

-- =========================
-- 4. Wallboard role
-- =========================
-- Read-only role for the TV display, which currently runs unauthenticated.
alter table drivers drop constraint drivers_role_check;
alter table drivers add constraint drivers_role_check
  check (role in ('driver', 'dispatcher', 'scheduler', 'admin', 'assistant', 'wallboard'));

-- =========================
-- 5. JWT claim helpers (used by the RLS policies in 004)
-- =========================
create or replace function app_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'app_role', '')
$$;

create or replace function app_driver_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

-- =========================
-- 6. Login roster
-- =========================
-- The only thing an unauthenticated client may read after the flip:
-- id + name of active users, for the login dropdown.
create or replace function login_roster()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from drivers where active = true order by name
$$;

revoke all on function login_roster() from public;
grant execute on function login_roster() to anon, authenticated;
