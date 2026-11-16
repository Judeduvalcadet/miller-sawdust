create or replace function qb_private.capture_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg public.qb_sync_config; old_body jsonb; new_body jsonb; begin
  if coalesce(current_setting('request.jwt.claims',true),'') = '' then return new; end if;
  if current_setting('request.jwt.claims',true)::jsonb->>'role' = 'service_role' then return new; end if;
  -- Accounting identity and bookkeeping are server-owned, including on edits
  -- that do not change customer-facing fields.
  if tg_op = 'UPDATE' then
    new.qb_id:=old.qb_id; new.qb_realm_id:=old.qb_realm_id;
    new.qb_sync_token:=old.qb_sync_token; new.qb_snapshot:=old.qb_snapshot;
    new.qb_sync_version:=old.qb_sync_version;
    new.qb_sync_status:=old.qb_sync_status; new.qb_sync_error:=old.qb_sync_error;
  else
    new.qb_id:=null; new.qb_realm_id:=null; new.qb_sync_token:=null;
    new.qb_snapshot:=null; new.qb_sync_version:=0;
    new.qb_sync_status:='unlinked'; new.qb_sync_error:=null;
  end if;
  select * into cfg from public.qb_sync_config where id and enabled;
  if not found then return new; end if;
  new_body := to_jsonb(new);
  if tg_op = 'UPDATE' then
    old_body := to_jsonb(old);
    if tg_table_name='customers' and (old_body->>'name',old_body->>'company_name',old_body->>'street_address',old_body->>'city',old_body->>'state',old_body->>'zip_code',old_body->>'country',old_body->>'phone',old_body->>'email',old_body->>'active') is not distinct from (new_body->>'name',new_body->>'company_name',new_body->>'street_address',new_body->>'city',new_body->>'state',new_body->>'zip_code',new_body->>'country',new_body->>'phone',new_body->>'email',new_body->>'active') then return new; end if;
    if tg_table_name='invoices' and (old_body->>'doc_number',old_body->>'status',old_body->'lines',old_body->>'customer_id',old_body->>'txn_date',old_body->>'due_date',old_body->>'note',old_body->>'total',old_body->>'balance',old_body->>'qb_archived') is not distinct from (new_body->>'doc_number',new_body->>'status',new_body->'lines',new_body->>'customer_id',new_body->>'txn_date',new_body->>'due_date',new_body->>'note',new_body->>'total',new_body->>'balance',new_body->>'qb_archived') then return new; end if;
    if tg_table_name='items' and (old_body->>'name',old_body->>'description',old_body->>'unit_price',old_body->>'active') is not distinct from (new_body->>'name',new_body->>'description',new_body->>'unit_price',new_body->>'active') then return new; end if;
  end if;
  new.qb_sync_version := coalesce(new.qb_sync_version,0)+1;
  new.qb_sync_status := 'pending'; new.qb_sync_error := null;
  insert into public.qb_sync_jobs(entity,record_id,version,realm_id,payload)
    values(tg_table_name,new.id,new.qb_sync_version,cfg.realm_id,to_jsonb(new));
  return new;
end $$;

alter table public.qb_sync_config add column reconcile_cursor jsonb;
