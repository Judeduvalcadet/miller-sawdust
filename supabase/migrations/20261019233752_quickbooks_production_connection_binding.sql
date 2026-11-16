-- Older connections are retained until the owner authorizes the new OAuth app.
-- Never refresh one app's tokens using another app's credentials.
alter table public.qb_tokens add column if not exists oauth_client_id text;
