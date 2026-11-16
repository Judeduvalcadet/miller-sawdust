# Approved office workflow changes

Implement locally in Miller Sawdust. No production deployment or QuickBooks catch-up.

1. Constrain portaled menus to viewport space; verify bottom-row assignment and scrolling.
2. Reuse Reports and full report pages under V2 routes with a neutral scoped theme.
3. Move delivery truck selectors above load containers; expose pickup truck selector at top.
4. Add invoice billing snapshots with shipping/default, existing customer, and new address modes. Use Google address suggestions. Retain delivery customer for pricing.
5. Atomically remember saved per-item invoice rates on the delivery customer. Ignore unchanged historical rates and server imports; preserve other invoices. Invalidate cached rates after saves.
6. Verify SQL rollback tests, billing helper tests, production build and local browser flows. Defer live QuickBooks connection/payment reconciliation until client connects.

## Local verification
- Additive migration applied and recorded only in local Miller Supabase.
- Pricing regression transaction passed and rolled back its fixtures: new rate, changed rate, quantity-only historical edit, unaffected other invoice, ignored service import.
- Seven billing tests and two release guard tests passed.
- Browser test (mocked API, no mail sent) passed: bottom week assignment placement/scroll, truck selector position, reports route, new billing address preview.
- Local PostgREST invoice/customer relation confirmed after adding second customer foreign key.
- Production build, targeted ESLint and diff whitespace checks passed.
- Independent review addressed preservation of legacy multiline addresses and nonblocking unchanged contact fields.
- QuickBooks connection, live payment reconciliation and production deployment remain deferred.

## Customer address placement correction
At the user's request, move the address selector into the customer information page alongside Pricing, with no pricing subtitle. Save a customer billing_preference (shipping, searchable current/past customer, or new address with Google suggestions). Show the latest scheduled delivery job address when available; each new invoice resolves shipping from its own job. Remove all invoice billing editing controls. Preserve existing invoice snapshots. Block new invoice creation when customer preference cannot be loaded. Customer preference migration applied locally and to shared hosted database for the dev release.
Validation: 11 billing tests; browser customer save/remount, existing-customer search, custom address and automatic invoice preview; local database rollback persistence check; build and targeted lint.

## Dispatch send dialog
SMS is confirmed operational by the user and is not an outstanding setup task.
- Day and week dispatch snapshots expose Send Invoice with compact footer actions.
- Reuse customer billing controls in the send dialog, alongside SMS/Email tabs (SMS default).
- Footer actions: Cancel, Preview, dynamic Send via SMS/email. Preview uses current billing selection; Send persists pending customer billing edits and prepares the invoice/PDF. Explicit address saves also persist to the customer profile.
- Preserve older billing snapshots and freeze prepared billing for safe retries after contact changes. Prevent concurrent double sends. Cancel discards unsaved dialog edits.
- Browser test intercepts all messages; verifies both snapshot entry points, customer save, unsaved billing preview, cancel, email transient retry with stable request ID, and SMS PDF send. No real test messages sent.
