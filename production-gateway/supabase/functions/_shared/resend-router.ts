import { Webhook } from "npm:svix@1.76.1/dist/webhook.js";

export type EmailRoute = { company: string; endpoint: string; secret: string };
export type Receipt = {
  event_id: string;
  sender_domain: string;
  email_id: string;
  event_type: string;
  occurred_at: string;
  delivered_at?: string | null;
};
export interface ReceiptStore {
  save(receipt: Receipt): Promise<Receipt>;
  pending(domains: string[], perDomain: number): Promise<Receipt[]>;
  delivered(id: string): Promise<void>;
}
const types = new Set([
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
]);
const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
export function senderDomain(value: unknown): string | null {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return null;
  const email = value.trim().match(/^(?:[^<>]*<([^<>]+)>|([^<>\s]+))$/);
  const address = (email?.[1] || email?.[2] || "").toLowerCase();
  const match = address.match(/^[^\s@<>]+@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/);
  return match && !match[1].includes("..") && match[1].includes(".")
    ? match[1]
    : null;
}
export function createResendRouter(options: {
  secret: string;
  retryKey: string;
  routes: Record<string, EmailRoute>;
  store: ReceiptStore;
  fetcher?: typeof fetch;
}) {
  const { secret, retryKey, routes, store } = options;
  if (!secret.startsWith("whsec_") || retryKey.length < 32) {
    throw Error("Receipt verification is not configured.");
  }
  const keys = new Map<string, string>(), endpoints = new Map<string, string>();
  for (const [domain, route] of Object.entries(routes)) {
    const url = new URL(route.endpoint);
    if (
      senderDomain("test@" + domain) !== domain ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(route.company) ||
      url.protocol !== "https:" || url.username || url.password || url.hash ||
      url.search ||
      url.port || !url.hostname.includes(".") ||
      /^(?:\d+\.){3}\d+$/.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) ||
      !route.secret.startsWith("whsec_") || route.secret === secret ||
      (keys.has(route.secret) && keys.get(route.secret) !== route.company) ||
      (endpoints.has(route.endpoint) &&
        endpoints.get(route.endpoint) !== route.company)
    ) {
      throw Error(
        "Each company requires its own approved HTTPS receiver and signing key.",
      );
    }
    new Webhook(route.secret);
    keys.set(route.secret, route.company);
    endpoints.set(route.endpoint, route.company);
  }
  const verifier = new Webhook(secret);
  async function deliver(row: Receipt): Promise<boolean> {
    if (row.delivered_at) return true;
    const route = Object.hasOwn(routes, row.sender_domain)
      ? routes[row.sender_domain]
      : null;
    if (!route) return false;
    // Forward only identifiers/status. Never copy recipients, subjects or invoice content.
    const body = JSON.stringify({
      type: row.event_type,
      created_at: row.occurred_at,
      data: { email_id: row.email_id, sender_domain: row.sender_domain },
    });
    const now = new Date(),
      signature = new Webhook(route.secret).sign(row.event_id, now, body);
    const result = await (options.fetcher || fetch)(route.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(4000),
      headers: {
        "content-type": "application/json",
        "svix-id": row.event_id,
        "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
        "svix-signature": signature,
      },
      body,
    });
    if (!result.ok) return false;
    await store.delivered(row.event_id);
    return true;
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return response(405, { error: "method_not_allowed" });
    }
    try {
      if (new URL(request.url).searchParams.get("action") === "retry") {
        const provided = request.headers.get("x-jobyard-retry-key") || "";
        // Hash both inputs before comparison, so the comparison reveals no secret prefix.
        const hash = async (v: string) =>
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
          );
        const a = await hash(provided), b = await hash(retryKey);
        let difference = 0;
        for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
        if (!provided || difference) {
          return response(403, { error: "unauthorized" });
        }
        const pending = await store.pending(Object.keys(routes), 1);
        const results = await Promise.allSettled(pending.map(deliver));
        return response(200, {
          attempted: results.length,
          delivered: results.filter((r) =>
            r.status === "fulfilled" && r.value
          ).length,
        });
      }
      const raw = await request.text();
      if (raw.length > 100000) {
        return response(413, { error: "payload_too_large" });
      }
      let event: any;
      try {
        event = verifier.verify(raw, {
          "svix-id": request.headers.get("svix-id") || "",
          "svix-timestamp": request.headers.get("svix-timestamp") || "",
          "svix-signature": request.headers.get("svix-signature") || "",
        });
      } catch {
        return response(403, { error: "invalid_signature" });
      }
      if (!types.has(event.type)) return response(200, { ignored: true });
      const domain = senderDomain(event.data?.from),
        id = request.headers.get("svix-id") || "";
      if (
        !domain || !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
        typeof event.data?.email_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(event.data.email_id) ||
        typeof event.created_at !== "string" ||
        !Number.isFinite(Date.parse(event.created_at))
      ) {
        return response(400, { error: "invalid_payload" });
      }
      const row = await store.save({
        event_id: id,
        sender_domain: domain,
        email_id: event.data.email_id,
        event_type: event.type,
        occurred_at: event.created_at,
      });
      if (!Object.hasOwn(routes, domain)) {
        return response(202, { queued: true });
      }
      // A receiver failure retains the inbox row and asks Resend to retry this event.
      return await deliver(row)
        ? response(200, { delivered: true })
        : response(503, { error: "delivery_pending" });
    } catch {
      return response(503, { error: "delivery_pending" });
    }
  };
}
