-- One SQL statement supplies both database aggregates and the complete source
-- set from the same snapshot. Service-role only; no SQL supplied by the model.
create or replace function public.assistant_dev_report(p_spec jsonb)
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
revoke all on function public.assistant_dev_report(jsonb) from public,anon,authenticated;
grant execute on function public.assistant_dev_report(jsonb) to service_role;
