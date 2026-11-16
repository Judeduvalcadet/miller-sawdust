import { emailSenderAddress, receiptStatus } from "./messaging-core.ts";
import { verifiedResend } from "./messaging-webhooks.ts";
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
function checked(result: { data?: unknown; error: unknown }) {
  if (result.error) throw Error("Receipt database unavailable.");
}
// The database client is supplied by the installation, never selected by the sender.
export function createResendReceiptHandler(options: {
  db: any;
  primarySecret: string;
  relaySecret: string;
  sender: string;
  writable: () => void;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return new Response("POST required", { status: 405 });
    }
    const raw = await req.text();
    if (raw.length > 100000) return new Response("Too large", { status: 413 });
    let event, relayed = false;
    try {
      event = verifiedResend(
        options.primarySecret,
        raw,
        req.headers,
      );
    } catch {
      try {
        event = verifiedResend(options.relaySecret, raw, req.headers);
        relayed = true;
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
    }
    try {
      // Team-wide Resend webhooks can include every company's mail. Only the
      // configured sending domain may enter this installation's receipt inbox.
      const expected = emailSenderAddress(options.sender).split("@")[1];
      const incoming = relayed
        ? event.data?.sender_domain
        : emailSenderAddress(event.data?.from || "").split("@")[1];
      if (!expected || !incoming) {
        return new Response("Invalid sender", { status: 400 });
      }
      if (incoming !== expected) return reply(200, { ignored: true });
      options.writable();
      const status = receiptStatus("resend", event.type);
      if (!status) return reply(200, { ok: true });
      if (
        !event.data.email_id || !Number.isFinite(Date.parse(event.created_at))
      ) {
        return new Response("Invalid event", { status: 400 });
      }
      checked(
        await options.db
          .from("messaging_events")
          .upsert(
            {
              provider: "resend",
              event_id: req.headers.get("svix-id"),
              provider_id: event.data.email_id,
              status,
              error: ["failed", "bounced", "complained"].includes(status)
                ? `Email ${status}`
                : null,
              occurred_at: event.created_at,
            },
            { onConflict: "provider,event_id", ignoreDuplicates: true },
          ),
      );
      checked(
        await options.db.rpc("messaging_reconcile", {
          p_provider: "resend",
          p_provider_id: event.data.email_id,
        }),
      );
      return reply(200, { ok: true });
    } catch {
      return reply(503, {
        error: "Callback could not be recorded. Retry later.",
      });
    }
  };
}
