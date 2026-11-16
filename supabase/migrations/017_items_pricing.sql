-- ============================================================================
-- 017_items_pricing.sql — the one-source-of-truth pricing chain.
--
-- items:                the QuickBooks Products & Services catalog, imported
--                       into the app so the SAME item drives the job-form
--                       presets, the customer price book, and (next) invoices.
--                       Editable here; two-way push to QBO lands in Phase 3.
-- customer_item_prices: per-customer price overrides ("what this customer
--                       usually pays"). Invoicing uses this price when a row
--                       exists, otherwise the item's standard unit_price.
-- jobs.item_id:         which catalog item a job's load was created from.
-- settings.company_profile: company details for V2 Settings + invoice PDFs.
-- ============================================================================

create table items (
  id uuid primary key default gen_random_uuid(),
  qb_id text,
  qb_sync_token text,
  qb_last_synced_at timestamptz,
  name text not null,
  description text,
  unit_price numeric(10,2),
  item_type text,                     -- QBO Type (NonInventory / Service)
  yards numeric,                      -- parsed from the name ("35yd ..." -> 35)
  truck_type text,                    -- straight_truck | spreader | semi | null
  is_load_item boolean not null default false,  -- offered as a job-form preset
  active boolean not null default true,
  sort_order integer,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create unique index items_qb_id_key on items (qb_id) where qb_id is not null;

alter table items enable row level security;

-- Catalog is readable app-wide (the job form needs the presets);
-- only the office maintains it.
create policy items_select on items for select
  to authenticated using (true);
create policy items_insert on items for insert
  to authenticated with check (app_role() in ('admin', 'assistant'));
create policy items_update on items for update
  to authenticated
  using (app_role() in ('admin', 'assistant'))
  with check (app_role() in ('admin', 'assistant'));
create policy items_delete on items for delete
  to authenticated using (app_role() = 'admin');

create table customer_item_prices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  price numeric(10,2) not null,
  is_default boolean not null default false,  -- the load this customer usually gets
  notes text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (customer_id, item_id)
);

create index customer_item_prices_customer_idx on customer_item_prices (customer_id);

alter table customer_item_prices enable row level security;

-- Customer pricing is office-only, same boundary as invoicing/QuickBooks:
-- the dispatcher role has no access.
create policy cip_select on customer_item_prices for select
  to authenticated using (app_role() in ('admin', 'assistant'));
create policy cip_insert on customer_item_prices for insert
  to authenticated with check (app_role() in ('admin', 'assistant'));
create policy cip_update on customer_item_prices for update
  to authenticated
  using (app_role() in ('admin', 'assistant'))
  with check (app_role() in ('admin', 'assistant'));
create policy cip_delete on customer_item_prices for delete
  to authenticated using (app_role() in ('admin', 'assistant'));

alter table jobs add column item_id uuid references items(id);

alter table settings add column company_profile jsonb;
