create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists gateway_private;
revoke all on schema gateway_private from public,anon,authenticated;
create or replace function gateway_private.retry_email_receipts() returns bigint
language plpgsql security invoker set search_path='' as $$
declare worker_key text; request_id bigint;
begin
  if not exists(select 1 from public.email_gateway_receipts where delivered_at is null) then return null; end if;
  select decrypted_secret into worker_key from vault.decrypted_secrets where name='jobyard_email_retry_key';
  if length(coalesce(worker_key,''))<32 then return null; end if;
  select net.http_post(url:='https://hvryrivqjqsxfcypvqie.supabase.co/functions/v1/resend-router?action=retry',headers:=jsonb_build_object('Content-Type','application/json','x-jobyard-retry-key',worker_key),body:='{}'::jsonb,timeout_milliseconds:=45000) into request_id;
  return request_id;
end $$;
revoke all on function gateway_private.retry_email_receipts() from public,anon,authenticated;
