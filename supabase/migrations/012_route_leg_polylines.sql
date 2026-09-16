-- ============================================================================
-- 012_route_leg_polylines.sql — store each cached leg's actual road geometry
-- (Google encoded polyline) so maps can draw real driving routes instead of
-- straight lines. Filled lazily by the route-path edge function.
-- ============================================================================

alter table route_legs add column polyline text;
