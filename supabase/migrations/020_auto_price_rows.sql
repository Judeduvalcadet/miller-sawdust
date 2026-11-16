-- ============================================================================
-- 020_auto_price_rows.sql — the price book fills itself from dispatch.
-- When a job gives a customer a catalog item they don't have a price row for
-- yet, add one at the item's standard price (their first load item becomes
-- their starred default). Runs as a trigger so it works regardless of who
-- creates the job — dispatchers can't touch customer_item_prices directly.
-- ============================================================================

create or replace function ensure_customer_item_prices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  iid uuid;
begin
  if new.customer_id is null then
    return new;
  end if;

  for iid in
    select distinct x.item_id from (
      select new.item_id as item_id
      union
      select (e->>'item_id')::uuid
      from jsonb_array_elements(coalesce(new.loads, '[]'::jsonb)) e
      where e->>'item_id' is not null and e->>'item_id' <> ''
    ) x
    where x.item_id is not null
  loop
    insert into customer_item_prices (customer_id, item_id, price, is_default, notes)
    select
      new.customer_id,
      i.id,
      coalesce(i.unit_price, 0),
      i.is_load_item and not exists (
        select 1 from customer_item_prices p
        where p.customer_id = new.customer_id and p.is_default
      ),
      'auto-added from a job'
    from items i
    where i.id = iid
    on conflict (customer_id, item_id) do nothing;
  end loop;

  return new;
end;
$$;

create trigger jobs_ensure_customer_item_prices
after insert or update of item_id, loads, customer_id on jobs
for each row execute function ensure_customer_item_prices();
