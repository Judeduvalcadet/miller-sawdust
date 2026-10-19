alter table public.qb_sync_config add column gateway_error text, add column gateway_last_polled_at timestamptz;
