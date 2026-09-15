-- ============================================================================
-- 010_assistant_log_category.sql — allow 'assistant' in log_entries.category
-- so every dispatch-assistant exchange is audit-logged under its own label.
-- ============================================================================

alter table log_entries drop constraint log_entries_category_check;
alter table log_entries add constraint log_entries_category_check
  check (category in ('frontend', 'backend', 'database', 'integration', 'assistant'));
