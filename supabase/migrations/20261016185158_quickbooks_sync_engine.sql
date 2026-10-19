create schema if not exists qb_private;
revoke all on schema qb_private from public;

create table public.qb_sync_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  realm_id text not null,
  lease_owner uuid,
  lease_until timestamptz,
  reconciled_at timestamptz
);
alter table public.qb_sync_config enable row level security;
revoke all on public.qb_sync_config from anon, authenticated;
grant all on public.qb_sync_config to service_role;

alter table public.customers add column active boolean not null default true;
alter table public.invoices add column qb_archived boolean not null default false;
do $$ declare t text; begin
  foreach t in array array['customers','invoices','items'] loop
    execute format('alter table public.%I add column qb_realm_id text, add column qb_sync_status text not null default ''unlinked'', add column qb_sync_error text, add column qb_sync_version bigint not null default 0, add column qb_snapshot jsonb', t);
  end loop;
end $$;

create table public.qb_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('customers','invoices','items')),
  record_id uuid not null,
  version bigint not null,
  realm_id text not null,
  payload jsonb,
  state text not null default 'pending' check (state in ('pending','done','error')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  error text,
  created_at timestamptz not null default now(),
  unique(entity, record_id, version)
);
create index qb_sync_jobs_pending on public.qb_sync_jobs(available_at) where state <> 'done';
alter table public.qb_sync_jobs enable row level security;
revoke all on public.qb_sync_jobs from anon, authenticated;
grant all on public.qb_sync_jobs to service_role;

create table public.qb_payments (
  qb_id text primary key,
  realm_id text not null,
  customer_id uuid references public.customers(id),
  amount numeric(12,2) not null,
  txn_date date,
  linked_invoice_ids jsonb not null default '[]',
  origin text not null default 'quickbooks',
  deleted boolean not null default false,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.qb_payments enable row level security;
revoke all on public.qb_payments from anon, authenticated;
grant select on public.qb_payments to authenticated;
grant all on public.qb_payments to service_role;
create policy qb_payments_office on public.qb_payments for select to authenticated using (public.app_role() in ('admin','assistant'));

-- A narrow trigger bridge queues only mutations already admitted by table RLS.
-- Imports use the service role and do not echo back out to QuickBooks.
create function qb_private.capture_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg public.qb_sync_config; old_body jsonb; new_body jsonb; begin
  if coalesce(current_setting('request.jwt.claims',true),'') = '' then return new; end if;
  if current_setting('request.jwt.claims',true)::jsonb->>'role' = 'service_role' then return new; end if;
  select * into cfg from public.qb_sync_config where id and enabled;
  if not found then return new; end if;
  new_body := to_jsonb(new);
  if tg_op = 'UPDATE' then
    old_body := to_jsonb(old);
    if tg_table_name='customers' and (old_body->>'name',old_body->>'company_name',old_body->>'street_address',old_body->>'city',old_body->>'state',old_body->>'zip_code',old_body->>'country',old_body->>'phone',old_body->>'email',old_body->>'active') is not distinct from (new_body->>'name',new_body->>'company_name',new_body->>'street_address',new_body->>'city',new_body->>'state',new_body->>'zip_code',new_body->>'country',new_body->>'phone',new_body->>'email',new_body->>'active') then return new; end if;
    if tg_table_name='invoices' and (old_body->'lines',old_body->>'customer_id',old_body->>'txn_date',old_body->>'due_date',old_body->>'note',old_body->>'total',old_body->>'balance',old_body->>'qb_archived') is not distinct from (new_body->'lines',new_body->>'customer_id',new_body->>'txn_date',new_body->>'due_date',new_body->>'note',new_body->>'total',new_body->>'balance',new_body->>'qb_archived') then return new; end if;
    if tg_table_name='items' and (old_body->>'name',old_body->>'description',old_body->>'unit_price',old_body->>'active') is not distinct from (new_body->>'name',new_body->>'description',new_body->>'unit_price',new_body->>'active') then return new; end if;
  end if;
  new.qb_sync_version := coalesce(new.qb_sync_version,0)+1;
  new.qb_sync_status := 'pending'; new.qb_sync_error := null;
  insert into public.qb_sync_jobs(entity,record_id,version,realm_id,payload)
    values(tg_table_name,new.id,new.qb_sync_version,cfg.realm_id,to_jsonb(new));
  return new;
end $$;
revoke all on function qb_private.capture_change() from public;
create trigger qb_customer_change before insert or update on public.customers for each row execute function qb_private.capture_change();
create trigger qb_invoice_change before insert or update on public.invoices for each row execute function qb_private.capture_change();
create trigger qb_item_change before insert or update on public.items for each row execute function qb_private.capture_change();

create function public.qb_take_lease(owner_id uuid) returns boolean
language sql security invoker set search_path='' as $$
 with taken as (update public.qb_sync_config set lease_owner=owner_id, lease_until=now()+interval '90 seconds'
 where id and enabled and (lease_until is null or lease_until<now()) returning id)
 select exists(select 1 from taken)
$$;
revoke all on function public.qb_take_lease(uuid) from public, anon, authenticated;
grant execute on function public.qb_take_lease(uuid) to service_role;

alter table public.qb_webhook_events add column attempts integer not null default 0, add column error text;

create table public.qb_payment_requests (
  request_id text primary key,
  invoice_id uuid not null references public.invoices(id),
  amount numeric(12,2) not null check(amount>0),
  qb_payment_id text,
  created_at timestamptz not null default now()
);
alter table public.qb_payment_requests enable row level security;
revoke all on public.qb_payment_requests from anon,authenticated;
grant all on public.qb_payment_requests to service_role;
