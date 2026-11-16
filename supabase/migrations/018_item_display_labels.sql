-- ============================================================================
-- 018_item_display_labels.sql — friendly front-end label per catalog item.
-- The QuickBooks item name stays the invoice/pricing identity; display_label
-- is what dispatch writes onto job cards when the item is picked in the job
-- form (editable per job without breaking the item link).
-- ============================================================================

alter table items add column display_label text;
