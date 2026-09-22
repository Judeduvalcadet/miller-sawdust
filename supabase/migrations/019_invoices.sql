-- ============================================================================
-- 019_invoices.sql — invoice history in the app + customer email.
--
-- invoices: every invoice, starting with the full QuickBooks import (source
-- 'quickbooks'); app-created invoices land here too in the invoicing build.
-- Office-only, same boundary as customer pricing — dispatchers have no access.
-- customers.email: QB has billing emails; needed on the customer info tab and
-- later for invoice delivery.
-- ============================================================================

alter table customers add column email text;

create table invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  qb_customer_id text,
  qb_id text,
  qb_sync_token text,
  doc_number text,
  txn_date date,
  due_date date,
  total numeric(12,2),
  balance numeric(12,2),
  status text,                       -- 'paid' | 'open'
  lines jsonb,                       -- [{item_qb_id, name, description, qty, unit_price, amount}]
  source text not null default 'quickbooks',
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create unique index invoices_qb_id_key on invoices (qb_id) where qb_id is not null;
create index invoices_customer_idx on invoices (customer_id);
create index invoices_txn_date_idx on invoices (txn_date);

alter table invoices enable row level security;

create policy invoices_select on invoices for select
  to authenticated using (app_role() in ('admin', 'assistant'));
create policy invoices_insert on invoices for insert
  to authenticated with check (app_role() in ('admin', 'assistant'));
create policy invoices_update on invoices for update
  to authenticated
  using (app_role() in ('admin', 'assistant'))
  with check (app_role() in ('admin', 'assistant'));
create policy invoices_delete on invoices for delete
  to authenticated using (app_role() in ('admin', 'assistant'));
