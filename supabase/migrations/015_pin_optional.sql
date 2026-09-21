-- ============================================================================
-- 015_pin_optional.sql — office accounts (owner / secretary) sign in with
-- email + password and may never have set a PIN, so a credentials row must
-- be able to exist without one.
-- ============================================================================

alter table driver_credentials alter column pin_bcrypt drop not null;
