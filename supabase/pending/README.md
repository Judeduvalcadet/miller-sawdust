# Pending migrations

Migrations staged here are **not** applied by `supabase db push`. They are kept
out of `supabase/migrations/` on purpose because applying them is a deliberate,
scheduled step (e.g. the RLS enforcement flip, which must run after hours).

To apply one: move it into `supabase/migrations/`, then `supabase db push`.
