-- ============================================================================
-- 021_invoice_workflow.sql — app-side invoice creation.
-- job_id ties an invoice to the delivery job it bills; note is the office's
-- free-text ("picked up by…"); sent_at marks the moment it was printed/sent.
-- next_invoice_number() continues the QuickBooks numbering sequence.
-- ============================================================================

alter table invoices
  add column job_id uuid references jobs(id),
  add column note text,
  add column sent_at timestamptz;

create index invoices_job_idx on invoices (job_id);

create or replace function next_invoice_number()
returns text
language sql
stable
as $$
  select (coalesce(max(doc_number::bigint), 10000) + 1)::text
  from invoices
  where doc_number ~ '^[0-9]+$'
$$;

grant execute on function next_invoice_number() to authenticated;
