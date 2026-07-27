-- ============================================================================
-- 006_entity_events.sql — change tracking for everything beyond jobs.
-- ADDITIVE, safe on live app. Same mechanism as job_events (005): a
-- security-definer trigger records every insert/update/delete on customers,
-- drivers, pickup/drop-off locations, and settings, with field-level diffs
-- and the acting user from the request JWT.
-- ============================================================================

create table entity_events (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  -- deliberately NOT a foreign key: history must survive record deletion
  record_id uuid not null,
  event_type text not null check (event_type in ('created', 'updated', 'deleted')),
  actor_name text,
  actor_role text,
  actor_id uuid,
  changes jsonb,   -- updated: { field: { from, to } }
  snapshot jsonb,  -- created/deleted: full row
  created_date timestamptz not null default now()
);

create index idx_entity_events_record on entity_events(table_name, record_id, created_date desc);

-- Read-only for logged-in users; the ONLY writer is the trigger below.
alter table entity_events enable row level security;
create policy entity_events_select on entity_events for select
  to authenticated using (true);

create or replace function log_entity_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  claims jsonb;
  actor_n text;
  actor_r text;
  actor_i uuid;
  old_j jsonb;
  new_j jsonb;
  diff jsonb := '{}'::jsonb;
  k text;
  -- per-table noise columns that would flood the log (e.g. every login
  -- bumps drivers.last_login_at)
  skip text[] := array['updated_date', 'last_login_at'];
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    claims := null;
  end;
  actor_n := claims ->> 'name';
  actor_r := claims ->> 'app_role';
  actor_i := nullif(claims ->> 'sub', '')::uuid;

  if tg_op = 'INSERT' then
    insert into entity_events (table_name, record_id, event_type, actor_name, actor_role, actor_id, snapshot)
    values (tg_table_name, new.id, 'created', actor_n, actor_r, actor_i, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    old_j := to_jsonb(old);
    new_j := to_jsonb(new);
    for k in select jsonb_object_keys(new_j) loop
      if k = any(skip) then continue; end if;
      if old_j -> k is distinct from new_j -> k then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_j -> k, 'to', new_j -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return new;
    end if;
    insert into entity_events (table_name, record_id, event_type, actor_name, actor_role, actor_id, changes)
    values (tg_table_name, new.id, 'updated', actor_n, actor_r, actor_i, diff);
    return new;
  elsif tg_op = 'DELETE' then
    insert into entity_events (table_name, record_id, event_type, actor_name, actor_role, actor_id, snapshot)
    values (tg_table_name, old.id, 'deleted', actor_n, actor_r, actor_i, to_jsonb(old));
    return old;
  end if;
  return null;
end $$;

create trigger trg_customers_log_events
  after insert or update or delete on customers
  for each row execute function log_entity_event();

create trigger trg_drivers_log_events
  after insert or update or delete on drivers
  for each row execute function log_entity_event();

create trigger trg_pickup_locations_log_events
  after insert or update or delete on pickup_locations
  for each row execute function log_entity_event();

create trigger trg_drop_off_locations_log_events
  after insert or update or delete on drop_off_locations
  for each row execute function log_entity_event();

create trigger trg_settings_log_events
  after insert or update or delete on settings
  for each row execute function log_entity_event();
