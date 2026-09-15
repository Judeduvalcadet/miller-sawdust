-- ============================================================================
-- 008_geocoding.sql — ADDITIVE, safe on live app. Coordinates + geocode
-- metadata for route optimization. Populated by the server-side geocoding
-- pipeline (Google key never touches the browser); address changes are
-- captured by the existing entity_events audit trigger.
-- ============================================================================

alter table customers
  add column latitude double precision,
  add column longitude double precision,
  add column geocode_formatted_address text,
  add column geocode_precision text,
  add column geocode_place_id text,
  add column geocoded_at timestamptz;

alter table pickup_locations
  add column latitude double precision,
  add column longitude double precision,
  add column geocode_formatted_address text,
  add column geocode_precision text,
  add column geocode_place_id text,
  add column geocoded_at timestamptz;

alter table drop_off_locations
  add column latitude double precision,
  add column longitude double precision,
  add column geocode_formatted_address text,
  add column geocode_precision text,
  add column geocode_place_id text,
  add column geocoded_at timestamptz;
