-- ============================================================================
-- 007_notification_events.sql — complete audit coverage: driver notifications
-- now record who sent/read/deleted them, same mechanism as 006.
-- ============================================================================

create trigger trg_driver_notifications_log_events
  after insert or update or delete on driver_notifications
  for each row execute function log_entity_event();
