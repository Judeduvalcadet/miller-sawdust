-- Credentials are used only by server functions. RLS with no policies already
-- denies client reads; revoke direct table privileges as an additional boundary.
begin;
alter table public.qb_tokens enable row level security;
alter table public.driver_credentials enable row level security;
revoke all privileges on table public.qb_tokens, public.driver_credentials from public, anon, authenticated;
grant select,insert,update,delete on table public.qb_tokens, public.driver_credentials to service_role;
commit;
