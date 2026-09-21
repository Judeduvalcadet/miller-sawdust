-- ============================================================================
-- 016_pickup_schedules.sql — standing pickup cadence per supplier, e.g.
-- Weaver Pallet = 2 loads every workday, Gregory = pine 1-2x/week. Left
-- empty on purpose; the office fills them in from the Pickup Locations page.
-- The dispatch assistant reads these to answer "does X still have
-- availability today?"
-- ============================================================================

alter table pickup_locations
  add column pickup_days text[],           -- days pickups are wanted: {mon..sun}
  add column pickups_per_day integer,      -- loads to take per pickup day
  add column pickup_schedule_notes text;   -- free text: "pine only", "call first"
