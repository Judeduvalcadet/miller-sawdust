-- ============================================================================
-- 005_job_events.sql — per-job activity history. ADDITIVE, safe on live app.
-- A trigger on jobs records every insert/update/delete: which fields changed,
-- old and new values, and who did it (from the request JWT claims).
-- ============================================================================

create table job_events (
  id uuid primary key default gen_random_uuid(),
  -- deliberately NOT a foreign key: history must survive job deletion
  job_id uuid not null,
  event_type text not null check (event_type in ('created', 'updated', 'deleted')),
  actor_name text,
  actor_role text,
  actor_id uuid,
  changes jsonb,   -- updated: { field: { from, to } }
  snapshot jsonb,  -- created/deleted: full row
  created_date timestamptz not null default now()
);

create index idx_job_events_job on job_events(job_id, created_date desc);

-- Read-only for logged-in users; the ONLY writer is the security-definer
-- trigger below (no insert/update/delete policies exist).
alter table job_events enable row level security;
create policy job_events_select on job_events for select
  to authenticated using (true);

create or replace function log_job_event() returns trigger
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
    insert into job_events (job_id, event_type, actor_name, actor_role, actor_id, snapshot)
    values (new.id, 'created', actor_n, actor_r, actor_i, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    old_j := to_jsonb(old);
    new_j := to_jsonb(new);
    for k in select jsonb_object_keys(new_j) loop
      if k = 'updated_date' then continue; end if;
      if old_j -> k is distinct from new_j -> k then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_j -> k, 'to', new_j -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return new;
    end if;
    insert into job_events (job_id, event_type, actor_name, actor_role, actor_id, changes)
    values (new.id, 'updated', actor_n, actor_r, actor_i, diff);
    return new;
  elsif tg_op = 'DELETE' then
    insert into job_events (job_id, event_type, actor_name, actor_role, actor_id, snapshot)
    values (old.id, 'deleted', actor_n, actor_r, actor_i, to_jsonb(old));
    return old;
  end if;
  return null;
end $$;

create trigger trg_jobs_log_events
  after insert or update or delete on jobs
  for each row execute function log_job_event();
