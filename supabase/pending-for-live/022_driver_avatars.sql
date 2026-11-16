-- PENDING FOR LIVE (prod freeze): applied to the LOCAL SANDBOX only on
-- 2026-09-28. Run against production as part of the go-live replay.
-- Driver profile photo, shown on the V2 dispatch board and wallboard.
alter table drivers add column avatar_url text;
