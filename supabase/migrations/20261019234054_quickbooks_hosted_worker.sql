-- The deploy step creates the schedule and stores this installation's worker
-- key in Vault. The cron definition contains neither credentials nor data.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create or replace function qb_private.wake_sync() returns bigint
language plpgsql security invoker set search_path='' as $$
declare endpoint text; worker_key text; request_id bigint;
begin
  if not exists(select 1 from public.qb_sync_config where id and enabled and (lease_until is null or lease_until<now())) then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='jobyard_qb_worker_url';
  select decrypted_secret into worker_key from vault.decrypted_secrets where name='jobyard_qb_worker_key';
  if endpoint is null or endpoint !~ '^https://[a-z]{20}\.supabase\.co/functions/v1/qb-sync$' or length(coalesce(worker_key,''))<32 then return null; end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-qb-worker-key',worker_key),body:='{"action":"run"}'::jsonb,timeout_milliseconds:=45000) into request_id;
  return request_id;
end $$;
revoke all on function qb_private.wake_sync() from public,anon,authenticated;
