import { service } from "../_shared/mod.ts";
import { writable } from "../_shared/messaging.ts";
import { createResendReceiptHandler } from "../_shared/resend-receipt.ts";
Deno.serve(createResendReceiptHandler({
  db: service, writable,
  primarySecret: Deno.env.get('RESEND_WEBHOOK_SECRET') || '',
  relaySecret: Deno.env.get('RESEND_RELAY_WEBHOOK_SECRET') || '',
  sender: Deno.env.get('INVOICE_FROM_EMAIL') || '',
}));
