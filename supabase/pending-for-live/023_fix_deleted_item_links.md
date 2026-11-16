# PENDING FOR LIVE — remap job links off deleted QB items

The 2026-09-24 text-mapping run on PRODUCTION matched item names without
filtering out inactive (deleted) QuickBooks items, so ~190 jobs' loads point
at "(deleted)" $0 items (mostly 30yd Mixed Shavings 1/2 and 1/3 → should be
the active 35yd versions). Fixed on the sandbox 2026-09-28.

At go-live (or earlier with explicit approval), run the same remap against
prod: the script lives in backups/job-invoice-link-2026-09-24/ (see the
session notes) — inactive item ids → active equivalents, updating
jobs.item_id and loads[].item_id. textmap-items.mjs itself is fixed
(byName now requires active) for any future runs.
