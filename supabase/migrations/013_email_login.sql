-- ============================================================================
-- 013_email_login.sql — email + password credentials for the office roles
-- (owner + secretary). Additive: PIN login is untouched; these columns are
-- only set for users who get elevated (invoicing / QuickBooks) access.
-- Sessions record how they were authenticated so QB-facing endpoints can
-- require a password session even for an admin.
-- ============================================================================

alter table driver_credentials
  add column email text,
  add column password_bcrypt text,
  add column password_updated_at timestamptz;

create unique index driver_credentials_email_unique
  on driver_credentials (lower(email)) where email is not null;

alter table driver_sessions
  add column auth_method text not null default 'pin';
