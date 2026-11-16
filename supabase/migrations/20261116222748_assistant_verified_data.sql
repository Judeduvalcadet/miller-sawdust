create or replace function public.assistant_dev_data(p_spec jsonb) returns jsonb
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
revoke all on function public.assistant_dev_data(jsonb) from public,anon,authenticated;
grant execute on function public.assistant_dev_data(jsonb) to service_role;
