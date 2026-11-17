create table if not exists public.assistant_live_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.drivers(id),
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  prompt text not null,
  reply text not null,
  results jsonb,
  checks jsonb not null default '[]',
  signals jsonb not null default '[]',
  tools jsonb not null default '[]',
  elapsed_ms integer not null,
  created_at timestamptz not null default now()
);
create index if not exists assistant_live_runs_user_time on public.assistant_live_runs(user_id,created_at desc);
create table if not exists public.assistant_live_feedback (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.assistant_live_runs(id) on delete cascade,
  user_id uuid not null references public.drivers(id),
  rating text not null check (rating in ('helpful','incorrect')),
  correction text not null default '',
  status text not null default 'pending' check (status in ('pending','resolved','rejected','verified')),
  reviewed_by uuid references public.drivers(id),
  verification_notes text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(run_id,user_id)
);
create table if not exists public.assistant_live_rules (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null unique references public.assistant_live_feedback(id),
  rule_text text not null check (length(rule_text) between 10 and 1000),
  kind text not null check (kind in ('terminology','presentation','lookup')),
  verification_notes text not null check (length(trim(verification_notes)) >= 20),
  verified_by uuid not null references public.drivers(id),
  verified_at timestamptz not null default now(),
  active boolean not null default true
);
alter table public.assistant_live_runs enable row level security;
alter table public.assistant_live_feedback enable row level security;
alter table public.assistant_live_rules enable row level security;
revoke all on public.assistant_live_runs, public.assistant_live_feedback, public.assistant_live_rules from anon, authenticated;
grant all on public.assistant_live_runs, public.assistant_live_feedback, public.assistant_live_rules to service_role;

-- Serialize feedback and approval so an edited correction cannot inherit approval.
create or replace function public.assistant_live_save_feedback(p_user uuid, p_run uuid, p_rating text, p_correction text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare f assistant_live_feedback;
begin
  if p_rating not in ('helpful','incorrect') then raise exception 'Invalid rating'; end if;
  perform id from assistant_live_runs where id=p_run and user_id=p_user for update;
  if not found then raise exception 'Run not found'; end if;
  select * into f from assistant_live_feedback where run_id=p_run and user_id=p_user for update;
  if f.status='verified' then raise exception 'Disable the verified rule before changing its feedback'; end if;
  insert into assistant_live_feedback(run_id,user_id,rating,correction) values(p_run,p_user,p_rating,left(p_correction,2000))
  on conflict(run_id,user_id) do update set rating=excluded.rating,correction=excluded.correction,status='pending',reviewed_by=null,reviewed_at=null,verification_notes=null,updated_at=clock_timestamp();
  return jsonb_build_object('saved',true);
end $$;
create or replace function public.assistant_live_review(p_user uuid,p_feedback uuid,p_expected timestamptz,p_decision text,p_rule text,p_kind text,p_notes text,p_verified boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare f assistant_live_feedback;
begin
  if not exists(select 1 from drivers where id=p_user and active=true and role='admin') then raise exception 'Administrator required'; end if;
  select * into f from assistant_live_feedback where id=p_feedback for update;
  if not found then raise exception 'Feedback not found'; end if;
  if p_expected is null or f.updated_at<>p_expected then raise exception 'Feedback changed. Refresh before reviewing.'; end if;
  if f.status<>'pending' then raise exception 'Feedback is no longer pending'; end if;
  if p_decision not in ('approve_rule','resolve','reject') then raise exception 'Invalid decision'; end if;
  if p_decision='approve_rule' then
    if f.rating<>'incorrect' or p_verified is distinct from true or length(trim(p_notes))<20 or length(trim(p_rule)) not between 10 and 1000 or p_kind not in ('terminology','presentation','lookup') then raise exception 'Verification evidence and a reusable correction are required'; end if;
    insert into assistant_live_rules(feedback_id,rule_text,kind,verification_notes,verified_by) values(f.id,trim(p_rule),p_kind,trim(p_notes),p_user)
    on conflict(feedback_id) do update set rule_text=excluded.rule_text,kind=excluded.kind,verification_notes=excluded.verification_notes,verified_by=p_user,verified_at=clock_timestamp(),active=true;
  end if;
  update assistant_live_feedback set status=case p_decision when 'approve_rule' then 'verified' when 'resolve' then 'resolved' else 'rejected' end,reviewed_by=p_user,reviewed_at=clock_timestamp(),verification_notes=p_notes,updated_at=clock_timestamp() where id=f.id;
  return jsonb_build_object('saved',true);
end $$;
revoke all on function public.assistant_live_save_feedback(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.assistant_live_review(uuid,uuid,timestamptz,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.assistant_live_save_feedback(uuid,uuid,text,text) to service_role;
grant execute on function public.assistant_live_review(uuid,uuid,timestamptz,text,text,text,text,boolean) to service_role;

-- One SQL statement supplies both database aggregates and the complete source
-- set from the same snapshot. Service-role only; no SQL supplied by the model.
create or replace function public.assistant_live_report(p_spec jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 ent text:=p_spec->>'entity'; dt text:=p_spec->>'date_field'; metric text:=p_spec->>'metric'; grp text:=p_spec->>'group_by';
 start_d date:=(p_spec->>'start_date')::date; end_d date:=(p_spec->>'end_date')::date;
 filt text; key_expr text; label_expr text; val_expr text; scope text; result jsonb; metric_label text; group_label text;
begin
 if ent not in ('jobs','invoices') or ent is null or start_d is null or end_d is null or end_d<start_d then raise exception 'Invalid report scope'; end if;
 if ent='jobs' then
   if dt not in ('scheduled_date','completed_at') or metric not in ('count','quantity') or grp not in ('none','driver','customer','status','truck_type') then raise exception 'Unsupported job report'; end if;
   filt:='t.deleted_at is null and coalesce(t.status,'''') <> ''cancelled''';
 else
   if dt not in ('txn_date','due_date') or metric not in ('count','total','balance') or grp not in ('none','customer','status') then raise exception 'Unsupported invoice report'; end if;
   filt:='coalesce(t.qb_archived,false)=false';
 end if;
 if dt is null or metric is null or grp is null then raise exception 'Missing report specification'; end if;
 if dt='completed_at' then
   filt:=filt||format(' and t.completed_at >= (%L::date::timestamp at time zone ''America/New_York'') and t.completed_at < ((%L::date+1)::timestamp at time zone ''America/New_York'')',start_d,end_d);
 else filt:=filt||format(' and t.%I >= %L::date and t.%I <= %L::date',dt,start_d,dt,end_d); end if;
 scope:=format('%s to %s, %s, %s',start_d,end_d,replace(dt,'_',' '),case when ent='jobs' then 'cancelled/deleted excluded' else 'archived excluded' end);
 if p_spec ? 'status' then filt:=filt||format(' and t.status=%L',p_spec->>'status');scope:=scope||', status: '||(p_spec->>'status'); end if;
 if p_spec ? 'job_type' then
   if ent<>'jobs' or p_spec->>'job_type' not in ('delivery','pickup') then raise exception 'Invalid job type'; end if;
   filt:=filt||format(' and t.job_type=%L',p_spec->>'job_type');scope:=scope||', '||(p_spec->>'job_type');
 end if;
 if p_spec ? 'customer_id' then filt:=filt||format(' and t.customer_id=%L::uuid',p_spec->>'customer_id');scope:=scope||', customer '||(p_spec->>'customer_id');end if;
 if p_spec ? 'driver_id' then
   if ent<>'jobs' then raise exception 'Driver filter only applies to jobs'; end if;
   filt:=filt||format(' and t.assigned_driver_id=%L::uuid',p_spec->>'driver_id');scope:=scope||', driver '||(p_spec->>'driver_id');end if;
 key_expr:=case grp when 'driver' then 'coalesce(t.assigned_driver_id::text,''unassigned'')' when 'customer' then 'coalesce(t.customer_id::text,''unassigned'')' when 'status' then 'coalesce(t.status,''unset'')' when 'truck_type' then 'coalesce(t.truck_type,''unset'')' else '''all''' end;
 label_expr:=case grp when 'driver' then 'coalesce((select name from drivers where id=t.assigned_driver_id),t.assigned_driver_name,''Unassigned'')' when 'customer' then 'coalesce((select name from customers where id=t.customer_id),''Unassigned'')' when 'status' then 'coalesce(t.status,''Unset'')' when 'truck_type' then 'coalesce(t.truck_type,''Unset'')' else '''All''' end;
 val_expr:=case when metric='count' then '1::numeric' else format('t.%I::numeric',metric) end;
 metric_label:=case metric when 'count' then 'Record count' when 'quantity' then 'Loads' when 'total' then 'Invoice total' else 'Outstanding balance' end;
 group_label:=case grp when 'none' then 'Group' else initcap(replace(grp,'_',' ')) end;
 execute format($query$
 with source as materialized (select t.id,%s as group_key,%s as label,%s as value from %I t where %s),
 stats as (select count(*) as n,coalesce(sum(value),0) as total,count(*) filter(where value is null) as missing from source),
 grouped as (select group_key,min(label) as label,count(*) as count,sum(value) as sum from source group by group_key)
 select jsonb_build_object('count',n,'sum',total,'missing',missing,'records',case when n<=10000 then (select coalesce(jsonb_agg(to_jsonb(s)),'[]') from source s) else '[]'::jsonb end,'groups',case when n<=10000 then (select coalesce(jsonb_agg(to_jsonb(g)),'[]') from grouped g) else '[]'::jsonb end) from stats
 $query$,key_expr,label_expr,val_expr,ent,filt) into result;
 if (result->>'count')::bigint>10000 then raise exception 'Report exceeds 10000 records. Narrow the date range.';end if;
 if (result->>'missing')::bigint>0 then raise exception 'Source amounts are missing. Correct the records before calculating this metric.';end if;
 return result||jsonb_build_object('entity',ent,'scope',scope,'metric_label',metric_label,'group_label',group_label,'money',metric in ('total','balance'));
end $$;
revoke all on function public.assistant_live_report(jsonb) from public,anon,authenticated;
grant execute on function public.assistant_live_report(jsonb) to service_role;

create or replace function public.assistant_live_data(p_spec jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
 allowed jsonb:='{"messaging_conversations":["id","channel","address","business_address","customer_id","display_name","archived","blocked","opted_out","last_message_at","last_preview","last_inbound_at","read_at","created_at"],"messaging_messages":["id","conversation_id","invoice_id","direction","channel","body","subject","status","provider","sent_by_name","dry_run","status_at","created_at"],"jobs":["id","job_type","truck_type","scheduled_date","assigned_driver_id","assigned_driver_name","assigned_driver_pickup_role","customer_id","customer_company_name","pickup_location_id","dropoff_location_id","dropoff_location_name","location_name","address","phone","quantity","pickup_yards","delivery_yards","yards_collected","load_configuration","loads","sort_order","item_id","status","dispatcher_notes","driver_notes","invoice_sent","payment_collected","invoice_marked_by","invoice_marked_at","payment_marked_by","payment_marked_at","completed_at","deleted_at","created_date","updated_date"],"customers":["id","name","company_name","street_address","city","state","country","zip_code","active","billing_preference","phone","email","map_image_url","delivery_instructions","created_date","updated_date","latitude","longitude","geocode_formatted_address","geocode_precision","geocode_place_id","geocoded_at"],"invoices":["id","customer_id","qb_customer_id","qb_id","qb_sync_token","doc_number","txn_date","due_date","total","balance","status","lines","source","billing_address","billing_customer_id","billing_mode","job_id","note","sent_at","edited_at","emailed_at","texted_at","created_date","updated_date","qb_archived"],"items":["id","name","description","unit_price","item_type","yards","truck_type","is_load_item","active","sort_order","display_label","created_date","updated_date","qb_id","qb_sync_token","qb_last_synced_at"],"customer_item_prices":["id","customer_id","item_id","price","is_default","notes","created_date","updated_date"],"drivers":["id","username","name","phone","role","driver_type","pickup_role","active","last_login_at","avatar_url","created_date","updated_date"],"pickup_locations":["id","name","phone","address","assigned_drivers","location_type","created_date","updated_date","latitude","longitude","geocode_formatted_address","geocode_precision","geocode_place_id","geocoded_at","pickup_days","pickups_per_day","pickup_schedule_notes"],"drop_off_locations":["id","name","address","notes","created_date","updated_date","latitude","longitude","geocode_formatted_address","geocode_precision","geocode_place_id","geocoded_at"],"settings":["id","truck_yard_presets","recurring_interval_presets","company_profile","created_date","updated_date"],"job_events":["id","job_id","event_type","actor_name","actor_role","actor_id","changes","snapshot","created_date"]}'::jsonb;
 ent text:=p_spec->>'entity'; operation text:=p_spec->>'operation'; val text:=p_spec->>'value_field'; grp text:=p_spec->>'group_by';
 field text; f jsonb; selected text:='id'; filt text:='true'; scope text:=''; expr text; key_expr text; result jsonb; typ text;
begin
 if not (allowed ? ent) or ent is null or operation not in ('records','count','sum') or operation is null then raise exception 'Unsupported report';end if;
 if jsonb_typeof(p_spec->'fields')<>'array' or jsonb_array_length(p_spec->'fields') not between 1 and 12 then raise exception 'Choose one to twelve source fields';end if;
 for field in select jsonb_array_elements_text(p_spec->'fields') loop
   if not (allowed->ent ? field) then raise exception 'Restricted field';end if;
   if field<>'id' then selected:=selected||','||quote_ident(field);end if;
 end loop;
 if ent='jobs' then filt:='deleted_at is null';scope:='Deleted jobs excluded. ';end if;
 if jsonb_typeof(coalesce(p_spec->'filters','[]'))<>'array' or jsonb_array_length(coalesce(p_spec->'filters','[]'))>10 then raise exception 'Invalid filters';end if;
 for f in select * from jsonb_array_elements(coalesce(p_spec->'filters','[]')) loop
   field:=f->>'field';
   if not (allowed->ent ? field) or field is null then raise exception 'Restricted filter';end if;
   if f->>'op'='is_null' then filt:=filt||format(' and %I is null',field);
   elsif f->>'op' in ('eq','gte','lte') then
     if f->>'value' is null then raise exception 'Missing filter value';end if;
     filt:=filt||format(' and %I %s %L',field,case f->>'op' when 'eq' then '=' when 'gte' then '>=' else '<=' end,f->>'value');
   elsif f->>'op'='contains' then filt:=filt||format(' and strpos(lower(%I::text),lower(%L))>0',field,f->>'value');
   else raise exception 'Unsupported filter';end if;
 end loop;
 scope:=scope||'Filters: '||coalesce(p_spec->'filters','[]')::text;
 if grp is not null and not (allowed->ent ? grp) then raise exception 'Restricted grouping';end if;
 key_expr:=case when grp is null then '''All''' else format('coalesce(%I::text,''Unset'')',grp) end;
 if operation='sum' then
   if val is null or not (allowed->ent ? val) or val not in ('quantity','pickup_yards','delivery_yards','yards_collected','total','balance','pickups_per_day') then raise exception 'This field has no approved additive calculation. Use original records instead.';end if;
   select data_type into typ from information_schema.columns where table_schema='public' and table_name=ent and column_name=val;
   if typ not in ('integer','bigint','smallint','numeric','real','double precision') then raise exception 'Non-numeric amount';end if;
 end if;
 expr:=case when operation='sum' then format('%I::numeric',val) else '1::numeric' end;
 execute format($q$
 with src as materialized(select id,%s as group_key,%s as value from %I where %s),
 stats as(select count(*) as n,coalesce(sum(value),0) as total,count(*) filter(where value is null) as missing from src),
 groups as(select group_key,group_key as label,count(*) as count,sum(value) as sum from src group by group_key)
 select jsonb_build_object('count',n,'sum',total,'missing',missing,'source',case when n<=10000 then (select coalesce(jsonb_agg(to_jsonb(s)),'[]') from (select %s from %I where %s) s) else '[]'::jsonb end,'records',case when n<=10000 then (select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('label',group_key)),'[]') from src s) else '[]'::jsonb end,'groups',case when n<=10000 then (select coalesce(jsonb_agg(to_jsonb(g)),'[]') from groups g) else '[]'::jsonb end) from stats
 $q$,key_expr,expr,ent,filt,selected,ent,filt) into result;
 if (result->>'count')::int>10000 then raise exception 'Too many source records. Narrow the filters.';end if;
 if (result->>'missing')::int>0 then raise exception 'Missing source values prevent verification.';end if;
 return result||jsonb_build_object('entity',ent,'operation',operation,'fields',p_spec->'fields','scope',scope,'metric_label',case when operation='sum' then replace(val,'_',' ') else 'Record count' end,'group_label',coalesce(grp,'Group'),'decimal_places',case when operation='sum' then 6 else 0 end,'money',false);
end $$;
revoke all on function public.assistant_live_data(jsonb) from public,anon,authenticated;
grant execute on function public.assistant_live_data(jsonb) to service_role;
