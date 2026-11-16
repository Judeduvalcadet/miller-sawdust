-- Billing is an invoice snapshot; pricing always belongs to the delivery customer.
-- Older hosted installations may not have the invoice edit timestamp yet.
alter table public.invoices add column if not exists edited_at timestamptz;
alter table public.invoices add column billing_address jsonb;
alter table public.invoices add column billing_customer_id uuid references public.customers(id) on delete set null;
alter table public.invoices add column billing_mode text check (billing_mode in ('shipping','customer','address'));

create or replace function public.remember_invoice_item_prices() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare line jsonb; claims jsonb; previous_lines jsonb; begin
  claims := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  -- Imports and background accounting/payment updates never change negotiated rates.
  if claims->>'role' is distinct from 'authenticated' or public.app_role() not in ('admin','assistant') then return new; end if;
  if new.customer_id is null then return new; end if;
  if tg_op = 'INSERT' and new.source is distinct from 'app' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.lines is not distinct from old.lines then return new; end if;
    previous_lines := coalesce(old.lines,'[]'::jsonb);
  else previous_lines := '[]'::jsonb; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(new.lines,'[]'::jsonb)) l
    where nullif(l->>'item_id','') is not null
    group by l->>'item_id' having count(distinct (l->>'unit_price')::numeric)>1
  ) then raise exception 'Use the same unit price for repeated instances of an item.'; end if;
  for line in select value from jsonb_array_elements(coalesce(new.lines,'[]'::jsonb)) loop
    if nullif(line->>'item_id','') is null then continue; end if;
    if (line->>'unit_price')::numeric is null or (line->>'unit_price')::numeric < 0 then
      raise exception 'Item prices must be zero or greater.';
    end if;
    -- Saving an old invoice without changing this rate must not restore an old price.
    if exists(select 1 from jsonb_array_elements(previous_lines) p
      where p->>'item_id'=line->>'item_id' and (p->>'unit_price')::numeric=(line->>'unit_price')::numeric) then continue; end if;
    insert into public.customer_item_prices(customer_id,item_id,price)
    values(new.customer_id,(line->>'item_id')::uuid,(line->>'unit_price')::numeric)
    on conflict(customer_id,item_id) do update set price=excluded.price, updated_date=now();
  end loop;
  return new;
end $$;
create trigger invoices_remember_item_prices after insert or update of lines on public.invoices
for each row execute function public.remember_invoice_item_prices();
