-- Invoices: when an invoice is edited after being sent, the app stamps
-- edited_at so the boards can badge it as "Edited". Applied to the sandbox
-- on 2026-09-28; run on production at go-live.
alter table invoices add column if not exists edited_at timestamptz;
