# Customer inbox implementation and activation

## Hosted email activation - October 2, 2026

Applied 025, 026 and 027 to linked project `mwunopdpquixccfdxpei` after checking
that the messaging tables were absent. Deployed `messaging`, `messaging-resend`
and `send-invoice`; the Twilio handler remains undeployed. Configured email
secrets only, preserving production authentication secrets.

Real sending is restricted server-side to `jude@xionthrive.com`; SMS is disabled.
Sender: Miller Sawdust <invoices@mail.millersawdust.app>.
Reply-To: millersawdust25@gmail.com.
Updated the Jude Cadet / JobYard LLC customer email in the hosted database.

Sent the existing SAMPLE-001 PDF using the shared sender against hosted storage
and database. No financial invoice was created. Message
`aabcd369-188f-4fd7-9b5b-7c5f457c49dc` received genuine signed Resend `sent` and
`delivered` callbacks and reached `delivered` in the hosted database. An unsigned
POST to the deployed webhook returned 403. Delivery confirms acceptance by the
recipient mail server, not inbox placement or reading.

Validation: all 16 messaging/template tests, function typechecks, and PGlite
schema/RLS/idempotency/receipt tests passed. The production frontend has NOT been
released; its existing read-only guards are unchanged. The local sandbox uses
its own database, so hosted receipt records do not update local conversations.

The original implementation notes below describe the pre-activation state.

The inbox schema (026) was applied to the existing isolated local sandbox on
2026-10-01; 025 was already present. All four messaging functions are served by
that sandbox's Edge Runtime. The frontend is available at
http://127.0.0.1:5174/v2/inbox in sandbox mode. Production is unchanged.

Verified against the running local database/functions: SMS simulation, repeat
request deduplication, invoice email/MMS simulation, private PDF storage/viewing,
unchanged invoice sent timestamps, office access enforcement and rejection of
unsigned callbacks. Synthetic test records/files were removed afterward.
The runtime uses INVOICE_SEND_DRY_RUN=true; external sending remains disabled.
Webhook SDK imports were narrowed to the official verification modules to keep
the local Edge Runtime within its memory limit.

No provider registration, DNS changes or real customer messages were performed.
Production activation remains a separate release. Do not replay 026 on this
already-migrated sandbox.

## What is included

- V2 Inbox: customer/recipient conversations, search, channel/unread filters,
  pagination, archive/restore, local block/unblock, attachment viewing and sending.
- SMS/MMS inbound replies and outbound provider receipts; server-verified Twilio
  signatures, account and destination checks, durable inbound IDs, STOP/START.
- Resend outbound email with attachments and signed delivery/bounce/failure events.
- Invoice sends use the same message history, request deduplication and receipts.
- Private files: authenticated office users request short-lived viewing links.
  Twilio receives a 30-day signed media URL; files are not in a public bucket.
- Unknown send outcomes are retained and never automatically resent. Operators
  must reconcile the provider ID/logs before intentionally starting a new send.
- Customer matching uses normalized email/phone only when the match is unique.
- Simulated messages do not stamp invoices as sent.

Scope: customer conversations and invoice delivery. Team/group fan-out, voice,
multiple business numbers and inbound email sync from Trail Plumbing are not part
of this implementation. Email replies use the company's reply-to for invoices;
ordinary inbox emails reply to the configured sending address. Configure a real
receiving mailbox before offering replies. Incoming email does not appear here.
The V1 AI assistant remains separate; this change does not alter its role boundary.

## Code structure

- `src/v2/V2Inbox.jsx`: queries, subscriptions, paging and conversation layout.
- `src/v2/inbox/`: new-conversation UI, media/status bubbles and API boundary.
- `_shared/messaging-core.ts`: input, media and receipt normalization.
- `_shared/messaging.ts`: office authentication, gates, reservation, storage,
  provider dispatch, request deduplication and uncertain-outcome handling.
- `messaging`: status/start/update/attachment/send API. Reads never auto-refresh
  integration tokens. All writes are server-gated and require an office password JWT.
- `send-invoice`: invoice-specific adapter to the same outbox.
- `messaging-twilio` / `messaging-resend`: signature-verified callbacks.
- `026_messaging.sql`: restricted tables, private bucket, invoice-ledger triggers,
  service-only receipt reconciliation and Realtime publication.

## Gates and environment

No secrets belong in VITE_* variables or the browser.

| Variable | Purpose |
| --- | --- |
| INVOICE_SEND_DRY_RUN=true | Simulate in the sandbox; enables local writes but never provider sends |
| MESSAGING_WRITES_ENABLED=true | Explicitly enables backend mutations outside simulation |
| MESSAGING_SEND_ENABLED=true | Separately enables provider calls, only if dry-run is off |
| RESEND_API_KEY | Resend sending credential |
| INVOICE_FROM_EMAIL | Verified-domain sender address |
| RESEND_WEBHOOK_SECRET | Signing secret for this project's Resend endpoint |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN | Account owning the sender and signing callbacks |
| TWILIO_FROM_NUMBER | Purchased, approved MMS-capable sender, in E.164 format |

Both mutation/sending flags default off. Provider keys alone do not activate sends.
`INVOICE_SEND_DRY_RUN=true` overrides external sending even if both flags are on.
The existing V2 client freeze is retained: non-sandbox builds cannot start, mark
read, archive, block, or send. Production activation also needs an explicit review
of that freeze; do not publish a sandbox build against production to bypass it.

## Sandbox validation

1. Install prior invoice migrations and pending 025, then 026, on isolated data.
2. Configure only sandbox auth and INVOICE_SEND_DRY_RUN=true initially.
3. Serve the four functions; config.toml disables gateway JWT checks because the
   functions validate Miller JWTs or provider signatures internally.
4. Run Vite in sandbox mode, sign in with an admin/assistant password session,
   open /v2/inbox, create a thread and simulate sends/attachments/invoices.
5. Confirm simulated history, no real delivery and no invoice sent timestamp.
6. Test callbacks with synthetic signed fixtures, including duplicates, callbacks
   before provider responses, and delivered followed by late sent events.

Automated checks (no live services):

    npm run test:messaging
    npm run check:messaging
    npm run build

The optional `tests/messaging-schema.mjs` runs migration/RLS/receipt tests against
an in-memory PGlite database. Set PGLITE_MODULE to an installed PGlite entrypoint.
`tests/inbox-browser.mjs` uses Playwright and a local Vite sandbox at 127.0.0.1:5175
with VITE_SUPABASE_URL=http://127.0.0.1:1 and a dummy anon key. It intercepts all API
traffic, never uses real credentials, and writes fixture screenshots under /tmp.
Set PLAYWRIGHT_MODULE to the installed Playwright entrypoint; CHROME_PATH is optional.
The repository-wide lint/typecheck already had unrelated failures at assessment.

## Provider activation checklist (not executed)

1. User confirms domain transfer/Resend verification, Twilio compliance approval,
   purchased MMS-capable number and A2P registration approval as applicable.
2. Review customer consent, opt-out handling and actual approved message samples.
   Register the sender with the correct Messaging Service/campaign. The invoice
   caption is `Miller Sawdust: Invoice #NUMBER`, with the PDF attached.
3. Apply reviewed migrations and deploy all four functions in the intended target.
4. Configure Twilio inbound POST URL:
   https://PROJECT.supabase.co/functions/v1/messaging-twilio
   Outbound requests supply their own status callback URL including message_id;
   signatures must cover that exact URL, including the query string.
5. Configure Resend webhook URL:
   https://PROJECT.supabase.co/functions/v1/messaging-resend
   Subscribe to email.sent, email.delivered, email.bounced, email.complained and
   email.failed. Save the endpoint signing secret server-side.
6. Enable writes/sending deliberately only after the client freeze release review.
7. Send only to designated test recipients first. Confirm actual PDF receipt,
   readable attachments, inbound replies, STOP/START and delivery/bounce states.
8. Check MMS on representative carriers/devices. Twilio accepting a PDF is not
   proof of device delivery. A2P approval does not remove PDF carrier restrictions.
   The current behavior attaches the PDF; no silent SMS-link fallback was added.

## Known operational limits

Email `delivered` means delivery to the recipient's mail server; SMS/MMS delivery
receipts are carrier reports, not proof the person opened/read the attachment.
PDF/media total is capped at 4 MB, but some carrier limits are lower. Tests must
cover real invoice sizes and the selected sender/carriers. No delivery has been
verified against real providers. A stalled `preparing`/`unknown` message requires
operator reconciliation; there is no automatic resend worker. Receipt events and
files currently have no retention cleanup job. Historical invoice_sends remain
available on invoices; only new sends populate the inbox.

Official references:
- https://www.twilio.com/docs/usage/webhooks/webhooks-security
- https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
- https://help.twilio.com/articles/360056727314-Carrier-support-for-PDF-files-sent-using-Twilio-MMS
- https://resend.com/docs/webhooks/verify-webhooks-requests
- https://resend.com/docs/webhooks/event-types
