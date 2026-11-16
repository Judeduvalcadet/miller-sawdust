-- Customer preference is for future invoices. Existing invoice snapshots stay intact.
alter table public.customers add column billing_preference jsonb
  check (billing_preference is null or (
    jsonb_typeof(billing_preference) = 'object'
    and billing_preference->>'mode' is not null
    and billing_preference->>'mode' in ('shipping','customer','address')
  ));
