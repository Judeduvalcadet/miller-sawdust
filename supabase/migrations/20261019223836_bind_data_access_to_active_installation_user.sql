begin;
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated, service_role;
-- This predicate returns only the caller's current role, never another user's
-- details. Its owner bypasses drivers RLS to avoid recursive policy evaluation.
create or replace function app_private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select d.role from public.drivers d
    where d.id = auth.uid() and d.active
      and d.role = coalesce(auth.jwt()->>'app_role','')), '');
$$;
revoke all on function app_private.current_role() from public;
grant execute on function app_private.current_role() to anon, authenticated, service_role;
create or replace function public.app_role() returns text
language sql stable security invoker set search_path = '' as $$
  select app_private.current_role();
$$;
-- Drivers keep their existing read access, but only while they are an active
-- user of this installation. A valid JWT from another installation is not enough.
do $$ declare p record; begin
  for p in select tablename, policyname from pg_policies
    where schemaname='public' and cmd='SELECT'
      and (qual='true' or qual=$policy$(app_role() <> ''::text)$policy$)
      and 'authenticated'=any(roles)
  loop
    execute format('alter policy %I on public.%I using ((select public.app_role()) <> '''')', p.policyname, p.tablename);
  end loop;
end $$;
commit;
