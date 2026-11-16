-- Serialize feedback and approval so an edited correction cannot inherit approval.
create or replace function public.assistant_dev_save_feedback(p_user uuid, p_run uuid, p_rating text, p_correction text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare f assistant_dev_feedback;
begin
  if p_rating not in ('helpful','incorrect') then raise exception 'Invalid rating'; end if;
  perform id from assistant_dev_runs where id=p_run and user_id=p_user for update;
  if not found then raise exception 'Run not found'; end if;
  select * into f from assistant_dev_feedback where run_id=p_run and user_id=p_user for update;
  if f.status='verified' then raise exception 'Disable the verified rule before changing its feedback'; end if;
  insert into assistant_dev_feedback(run_id,user_id,rating,correction) values(p_run,p_user,p_rating,left(p_correction,2000))
  on conflict(run_id,user_id) do update set rating=excluded.rating,correction=excluded.correction,status='pending',reviewed_by=null,reviewed_at=null,verification_notes=null,updated_at=clock_timestamp();
  return jsonb_build_object('saved',true);
end $$;
create or replace function public.assistant_dev_review(p_user uuid,p_feedback uuid,p_expected timestamptz,p_decision text,p_rule text,p_kind text,p_notes text,p_verified boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare f assistant_dev_feedback;
begin
  if not exists(select 1 from drivers where id=p_user and active=true and role='admin') then raise exception 'Administrator required'; end if;
  select * into f from assistant_dev_feedback where id=p_feedback for update;
  if not found then raise exception 'Feedback not found'; end if;
  if p_expected is null or f.updated_at<>p_expected then raise exception 'Feedback changed. Refresh before reviewing.'; end if;
  if f.status<>'pending' then raise exception 'Feedback is no longer pending'; end if;
  if p_decision not in ('approve_rule','resolve','reject') then raise exception 'Invalid decision'; end if;
  if p_decision='approve_rule' then
    if f.rating<>'incorrect' or p_verified is distinct from true or length(trim(p_notes))<20 or length(trim(p_rule)) not between 10 and 1000 or p_kind not in ('terminology','presentation','lookup') then raise exception 'Verification evidence and a reusable correction are required'; end if;
    insert into assistant_dev_rules(feedback_id,rule_text,kind,verification_notes,verified_by) values(f.id,trim(p_rule),p_kind,trim(p_notes),p_user)
    on conflict(feedback_id) do update set rule_text=excluded.rule_text,kind=excluded.kind,verification_notes=excluded.verification_notes,verified_by=p_user,verified_at=clock_timestamp(),active=true;
  end if;
  update assistant_dev_feedback set status=case p_decision when 'approve_rule' then 'verified' when 'resolve' then 'resolved' else 'rejected' end,reviewed_by=p_user,reviewed_at=clock_timestamp(),verification_notes=p_notes,updated_at=clock_timestamp() where id=f.id;
  return jsonb_build_object('saved',true);
end $$;
revoke all on function public.assistant_dev_save_feedback(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.assistant_dev_review(uuid,uuid,timestamptz,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.assistant_dev_save_feedback(uuid,uuid,text,text) to service_role;
grant execute on function public.assistant_dev_review(uuid,uuid,timestamptz,text,text,text,text,boolean) to service_role;
