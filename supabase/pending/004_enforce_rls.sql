-- ============================================================================
-- 004_enforce_rls.sql — THE FLIP. This is the only step that interrupts
-- clients still running the old bundle. Apply AFTER hours, and only after:
--   1. 003 is applied and the edge functions are deployed (APP_JWT_SECRET set)
--   2. scripts/migrate-pins.mjs has been run (all drivers have bcrypt creds)
--   3. The dual-mode frontend is live in production
-- To apply: move this file into supabase/migrations/ and `supabase db push`.
--
-- After this runs, the anon key alone can do nothing except call
-- login_roster(); every table requires an edge-function-issued JWT.
-- ============================================================================

-- =========================
-- 1. Drop the allow-all policies
-- =========================
drop policy "Allow all access to drivers" on drivers;
drop policy "Allow all access to customers" on customers;
drop policy "Allow all access to pickup_locations" on pickup_locations;
drop policy "Allow all access to drop_off_locations" on drop_off_locations;
drop policy "Allow all access to jobs" on jobs;
drop policy "Allow all access to driver_sessions" on driver_sessions;
drop policy "Allow all access to driver_notifications" on driver_notifications;
drop policy "Allow all access to settings" on settings;
drop policy "Allow all access to log_entries" on log_entries;

-- =========================
-- 2. drivers
-- =========================
-- Roster is needed app-wide; writes are for user management only.
create policy drivers_select on drivers for select
  to authenticated using (true);
create policy drivers_insert on drivers for insert
  to authenticated with check (app_role() in ('admin', 'dispatcher'));
create policy drivers_update on drivers for update
  to authenticated
  using (app_role() in ('admin', 'dispatcher'))
  with check (app_role() in ('admin', 'dispatcher'));
create policy drivers_delete on drivers for delete
  to authenticated using (app_role() in ('admin', 'dispatcher'));

-- =========================
-- 3. jobs
-- =========================
-- Office roles manage everything; drivers can update only their own jobs
-- (status, driver notes, yards collected); assistant updates invoicing fields.
create policy jobs_select on jobs for select
  to authenticated using (true);
create policy jobs_insert on jobs for insert
  to authenticated with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy jobs_update on jobs for update
  to authenticated
  using (
    app_role() in ('admin', 'dispatcher', 'scheduler', 'assistant')
    or (app_role() = 'driver' and assigned_driver_id = app_driver_id())
  )
  with check (
    app_role() in ('admin', 'dispatcher', 'scheduler', 'assistant')
    or (app_role() = 'driver' and assigned_driver_id = app_driver_id())
  );
create policy jobs_delete on jobs for delete
  to authenticated using (app_role() in ('admin', 'dispatcher', 'scheduler'));

-- =========================
-- 4. customers / locations / settings
-- =========================
-- Readable by everyone logged in (drivers need addresses + instructions);
-- writable by office roles.
create policy customers_select on customers for select
  to authenticated using (true);
create policy customers_write on customers for insert
  to authenticated with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy customers_update on customers for update
  to authenticated
  using (app_role() in ('admin', 'dispatcher', 'scheduler'))
  with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy customers_delete on customers for delete
  to authenticated using (app_role() in ('admin', 'dispatcher', 'scheduler'));

create policy pickup_locations_select on pickup_locations for select
  to authenticated using (true);
create policy pickup_locations_insert on pickup_locations for insert
  to authenticated with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy pickup_locations_update on pickup_locations for update
  to authenticated
  using (app_role() in ('admin', 'dispatcher', 'scheduler'))
  with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy pickup_locations_delete on pickup_locations for delete
  to authenticated using (app_role() in ('admin', 'dispatcher', 'scheduler'));

create policy drop_off_locations_select on drop_off_locations for select
  to authenticated using (true);
create policy drop_off_locations_insert on drop_off_locations for insert
  to authenticated with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy drop_off_locations_update on drop_off_locations for update
  to authenticated
  using (app_role() in ('admin', 'dispatcher', 'scheduler'))
  with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy drop_off_locations_delete on drop_off_locations for delete
  to authenticated using (app_role() in ('admin', 'dispatcher', 'scheduler'));

create policy settings_select on settings for select
  to authenticated using (true);
create policy settings_insert on settings for insert
  to authenticated with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy settings_update on settings for update
  to authenticated
  using (app_role() in ('admin', 'dispatcher', 'scheduler'))
  with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy settings_delete on settings for delete
  to authenticated using (app_role() = 'admin');

-- =========================
-- 5. driver_notifications
-- =========================
create policy driver_notifications_select on driver_notifications for select
  to authenticated
  using (app_role() in ('admin', 'dispatcher', 'scheduler') or driver_id = app_driver_id());
create policy driver_notifications_insert on driver_notifications for insert
  to authenticated with check (app_role() in ('admin', 'dispatcher', 'scheduler'));
create policy driver_notifications_update on driver_notifications for update
  to authenticated
  using (app_role() in ('admin', 'dispatcher', 'scheduler') or driver_id = app_driver_id())
  with check (app_role() in ('admin', 'dispatcher', 'scheduler') or driver_id = app_driver_id());
create policy driver_notifications_delete on driver_notifications for delete
  to authenticated using (app_role() in ('admin', 'dispatcher', 'scheduler'));

-- =========================
-- 6. log_entries
-- =========================
create policy log_entries_insert on log_entries for insert
  to authenticated with check (true);
create policy log_entries_select on log_entries for select
  to authenticated using (app_role() = 'admin');
create policy log_entries_delete on log_entries for delete
  to authenticated using (app_role() = 'admin');

-- driver_sessions, login_attempts, driver_credentials: RLS on, no policies —
-- edge functions (service role) only.

-- =========================
-- 7. Retire the legacy reversible PIN hash
-- =========================
alter table drivers drop column pin_hash;

-- =========================
-- 8. Storage: public read stays (customer map images), writes need a JWT
-- =========================
drop policy "Allow public insert on uploads" on storage.objects;
drop policy "Allow public update on uploads" on storage.objects;
drop policy "Allow public delete on uploads" on storage.objects;

create policy "Authenticated insert on uploads"
  on storage.objects for insert to authenticated with check (bucket_id = 'uploads');
create policy "Authenticated update on uploads"
  on storage.objects for update to authenticated using (bucket_id = 'uploads');
create policy "Authenticated delete on uploads"
  on storage.objects for delete to authenticated using (bucket_id = 'uploads');
