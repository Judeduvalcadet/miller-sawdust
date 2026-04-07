-- ============================================================================
-- Miller Sawdust Dispatch System — Initial Schema
-- Migration: 001_initial_schema.sql
-- ============================================================================

-- =========================
-- 1. Trigger function
-- =========================
create or replace function update_updated_date()
returns trigger as $$
begin
  new.updated_date = now();
  return new;
end;
$$ language plpgsql;

-- =========================
-- 2. Tables
-- =========================

-- drivers
create table drivers (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  name text not null,
  phone text,
  pin_hash text,
  role text not null default 'driver'
    check (role in ('driver', 'dispatcher', 'scheduler', 'admin', 'assistant')),
  driver_type text default 'delivery'
    check (driver_type in ('delivery', 'pickup')),
  pickup_role text default 'none'
    check (pickup_role in ('none', 'jon', 'josh')),
  active boolean default true,
  last_login_at timestamptz,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- customers
create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_name text,
  street_address text,
  city text,
  state text,
  country text,
  zip_code text,
  phone text,
  map_image_url text,
  delivery_instructions text,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- pickup_locations
create table pickup_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text not null,
  assigned_drivers text[] default '{}',
  location_type text default 'supplier'
    check (location_type in ('supplier', 'my_building')),
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- drop_off_locations
create table drop_off_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  notes text,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- jobs
create table jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null default 'delivery'
    check (job_type in ('delivery', 'pickup')),
  truck_type text default 'straight_truck'
    check (truck_type in ('straight_truck', 'semi', 'spreader')),
  scheduled_date date not null,
  assigned_driver_id uuid references drivers(id) on delete set null,
  assigned_driver_name text,
  assigned_driver_pickup_role text,
  customer_id uuid references customers(id) on delete set null,
  customer_company_name text,
  pickup_location_id uuid references pickup_locations(id) on delete set null,
  dropoff_location_id uuid references drop_off_locations(id) on delete set null,
  dropoff_location_name text,
  location_name text,
  address text,
  phone text,
  quantity integer default 1,
  pickup_yards numeric,
  delivery_yards numeric,
  yards_collected numeric,
  load_configuration text,
  loads jsonb,
  sort_order integer,
  status text default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  dispatcher_notes text,
  driver_notes text,
  invoice_sent text,
  payment_collected boolean default false,
  invoice_marked_by text,
  invoice_marked_at timestamptz,
  payment_marked_by text,
  payment_marked_at timestamptz,
  completed_at timestamptz,
  deleted_at timestamptz,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- driver_sessions
create table driver_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  device_id text,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- driver_notifications
create table driver_notifications (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  message text not null,
  read boolean default false,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- settings
create table settings (
  id uuid primary key default gen_random_uuid(),
  truck_yard_presets jsonb,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- log_entries
create table log_entries (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz default now(),
  level text not null
    check (level in ('info', 'warn', 'error', 'debug')),
  message text not null,
  category text not null
    check (category in ('frontend', 'backend', 'database', 'integration')),
  user_id text,
  details jsonb,
  created_date timestamptz default now(),
  updated_date timestamptz default now()
);

-- =========================
-- 3. updated_date triggers
-- =========================

create trigger trg_drivers_updated_date
  before update on drivers
  for each row execute function update_updated_date();

create trigger trg_customers_updated_date
  before update on customers
  for each row execute function update_updated_date();

create trigger trg_pickup_locations_updated_date
  before update on pickup_locations
  for each row execute function update_updated_date();

create trigger trg_drop_off_locations_updated_date
  before update on drop_off_locations
  for each row execute function update_updated_date();

create trigger trg_jobs_updated_date
  before update on jobs
  for each row execute function update_updated_date();

create trigger trg_driver_sessions_updated_date
  before update on driver_sessions
  for each row execute function update_updated_date();

create trigger trg_driver_notifications_updated_date
  before update on driver_notifications
  for each row execute function update_updated_date();

create trigger trg_settings_updated_date
  before update on settings
  for each row execute function update_updated_date();

create trigger trg_log_entries_updated_date
  before update on log_entries
  for each row execute function update_updated_date();

-- =========================
-- 4. Indexes
-- =========================

create index idx_jobs_scheduled_date on jobs(scheduled_date);
create index idx_jobs_assigned_driver_id on jobs(assigned_driver_id);
create index idx_jobs_customer_id on jobs(customer_id);
create index idx_jobs_status on jobs(status);
create index idx_driver_sessions_driver_id on driver_sessions(driver_id);
create index idx_driver_notifications_driver_id on driver_notifications(driver_id);

-- =========================
-- 5. Row Level Security
-- =========================

-- Enable RLS on all tables
alter table drivers enable row level security;
alter table customers enable row level security;
alter table pickup_locations enable row level security;
alter table drop_off_locations enable row level security;
alter table jobs enable row level security;
alter table driver_sessions enable row level security;
alter table driver_notifications enable row level security;
alter table settings enable row level security;
alter table log_entries enable row level security;

-- Permissive policies allowing all operations via anon key
-- (PIN-based auth is handled at the application layer)

create policy "Allow all access to drivers"
  on drivers for all using (true) with check (true);

create policy "Allow all access to customers"
  on customers for all using (true) with check (true);

create policy "Allow all access to pickup_locations"
  on pickup_locations for all using (true) with check (true);

create policy "Allow all access to drop_off_locations"
  on drop_off_locations for all using (true) with check (true);

create policy "Allow all access to jobs"
  on jobs for all using (true) with check (true);

create policy "Allow all access to driver_sessions"
  on driver_sessions for all using (true) with check (true);

create policy "Allow all access to driver_notifications"
  on driver_notifications for all using (true) with check (true);

create policy "Allow all access to settings"
  on settings for all using (true) with check (true);

create policy "Allow all access to log_entries"
  on log_entries for all using (true) with check (true);

-- =========================
-- 6. Realtime
-- =========================

alter publication supabase_realtime add table jobs, drivers, customers, pickup_locations, drop_off_locations;

-- =========================
-- 7. Storage bucket
-- =========================

insert into storage.buckets (id, name, public)
  values ('uploads', 'uploads', true);

-- Allow public read/write on the uploads bucket
create policy "Allow public read on uploads"
  on storage.objects for select using (bucket_id = 'uploads');

create policy "Allow public insert on uploads"
  on storage.objects for insert with check (bucket_id = 'uploads');

create policy "Allow public update on uploads"
  on storage.objects for update using (bucket_id = 'uploads');

create policy "Allow public delete on uploads"
  on storage.objects for delete using (bucket_id = 'uploads');
