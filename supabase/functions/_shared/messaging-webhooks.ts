import { validateRequest } from "npm:twilio@5.10.4/lib/webhooks/webhooks.js";
import { Webhook } from "npm:svix@1.76.1/dist/webhook.js";

export function validTwilio(
  token: string,
  signature: string,
  url: string,
  params: Record<string, string>,
) {
  return (
    !!token &&
    !!signature &&
    validateRequest(token, signature, url, params)
  );
}
export function verifiedResend(
  secret: string,
  payload: string,
  headers: Headers,
) {
  if (!secret) throw new Error("Webhook verification is not configured.");
  return new Webhook(secret).verify(payload, {
    "svix-id": headers.get("svix-id") || "",
    "svix-timestamp": headers.get("svix-timestamp") || "",
    "svix-signature": headers.get("svix-signature") || "",
  }) as { type: string; created_at: string; data: { email_id: string; from?: string; sender_domain?: string } };
}
