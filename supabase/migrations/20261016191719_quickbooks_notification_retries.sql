alter table public.qb_webhook_events add column available_at timestamptz not null default now();
create index qb_webhook_events_ready on public.qb_webhook_events(available_at,received_at) where processed_at is null;
