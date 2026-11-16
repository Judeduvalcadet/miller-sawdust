-- ============================================================================
-- 009_route_legs.sql — cache of road travel times between stop coordinates,
-- written only by the optimize-route edge function (service role). Keeping
-- legs here means each origin->destination pair costs one Google Routes call
-- ever, instead of one per route check.
-- ============================================================================

create table route_legs (
  od_key text primary key,          -- "lat,lng|lat,lng" rounded to 5 decimals
  seconds integer not null,
  meters integer not null,
  fetched_at timestamptz not null default now()
);

-- Service-role only: RLS on with no policies.
alter table route_legs enable row level security;
