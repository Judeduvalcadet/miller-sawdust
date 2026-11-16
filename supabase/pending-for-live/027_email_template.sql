-- Apply to the local sandbox now; apply to hosted DB with the V2 messaging release.
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS email_template jsonb;
