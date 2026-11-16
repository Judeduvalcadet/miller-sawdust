-- Per-installation pending requests, never exposed to browser roles.
create table public.qb_oauth_requests (
  nonce_hash text primary key,
  user_id uuid not null,
  expected_realm_ciphertext text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  claimed_at timestamptz,
  result_hash text unique,
  result_status text check(result_status in ('connected','cancelled','failed','company_mismatch')),
  redeemed_at timestamptz
);
alter table public.qb_oauth_requests enable row level security;
revoke all on public.qb_oauth_requests from public, anon, authenticated;
grant all on public.qb_oauth_requests to service_role;
create index qb_oauth_expiry on public.qb_oauth_requests(expires_at);
-- Claims are atomic: two callbacks cannot exchange one code concurrently.
create function public.qb_claim_oauth(p_nonce text)
returns setof public.qb_oauth_requests language sql security invoker set search_path=public
as $$ update public.qb_oauth_requests set claimed_at=now()
where nonce_hash=p_nonce and claimed_at is null and expires_at>now() returning * $$;
revoke all on function public.qb_claim_oauth(text) from public,anon,authenticated;
grant execute on function public.qb_claim_oauth(text) to service_role;
create function public.qb_redeem_oauth(p_result text,p_user uuid)
returns setof public.qb_oauth_requests language sql security invoker set search_path=public
as $$ update public.qb_oauth_requests set redeemed_at=now()
where result_hash=p_result and user_id=p_user and redeemed_at is null and expires_at>now() returning * $$;
revoke all on function public.qb_redeem_oauth(text,uuid) from public,anon,authenticated;
grant execute on function public.qb_redeem_oauth(text,uuid) to service_role;
