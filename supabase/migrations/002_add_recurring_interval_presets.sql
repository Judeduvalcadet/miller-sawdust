-- Add recurring interval presets to settings
alter table settings add column if not exists recurring_interval_presets jsonb;
