import { service, verifyAccessToken } from "./mod.ts";
import {
  decodeAttachment,
  MAX_ATTACHMENT_BYTES,
  mediaFilename,
  normalizeAddress,
  emailSenderAddress,
} from "./messaging-core.ts";

export type AttachmentInput = { name: string; type: string; content: string };
export type SendInput = {
  request_id: string;
  conversation_id?: string;
  channel: string;
  to: string;
  body: string;
  subject?: string;
  customer_id?: string;
  invoice_id?: string;
  attachments?: AttachmentInput[];
  reply_to?: string;
};
export class MessagingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
// Supabase query results have many shapes; this boundary always checks errors.
export function checked(result: { error: unknown; data?: any }): any {
  if (result.error)
    throw new MessagingError(
      "Could not save or load messaging data. Check that the inbox migration is installed.",
      503,
    );
  return result.data;
}
export async function office(req: Request) {
  const claims = await verifyAccessToken(req);
  if (
    !claims ||
    !["admin", "assistant"].includes(String(claims.app_role)) ||
    claims.amr !== "password"
  ) {
    throw new MessagingError("Office email/password sign-in required.", 403);
  }
  const {data:account,error}=await service.from('drivers').select('role,active').eq('id',String(claims.sub)).maybeSingle();
  if(error||!account?.active||!['admin','assistant'].includes(account.role)||account.role!==claims.app_role)throw new MessagingError('Your office access changed. Sign in again.',403);
  return claims;
}
export function config() {
  const sandbox = Deno.env.get('APP_ENV') === 'sandbox';
  const dryRun = sandbox || Deno.env.get("INVOICE_SEND_DRY_RUN") === "true";
  const writable =
    dryRun || Deno.env.get("MESSAGING_WRITES_ENABLED") === "true";
  const enabled = !sandbox && Deno.env.get("MESSAGING_SEND_ENABLED") === "true";
  const testEmail = Deno.env.get("MESSAGING_TEST_EMAIL_TO")?.trim().toLowerCase() || null;
  const testSms = Deno.env.get('MESSAGING_TEST_SMS_TO')?.trim() || null;
  const emailConfigured = [
    "RESEND_API_KEY",
    "INVOICE_FROM_EMAIL",
  ].every((k) => !!Deno.env.get(k)) && (!!Deno.env.get("RESEND_WEBHOOK_SECRET") || !!Deno.env.get('RESEND_RELAY_WEBHOOK_SECRET') || !!testEmail);
  const smsConfigured = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
  ].every((k) => !!Deno.env.get(k));
  return {
    test_email_to: testEmail,
    test_sms_to: testSms,
    dry_run: dryRun,
    writable,
    email_ready: writable && (dryRun || (enabled && emailConfigured)),
    sms_ready: (!testEmail || !!testSms) && writable && (dryRun || (enabled && smsConfigured)),
    external_sending_enabled: enabled && !dryRun,
  };
}
export function writable() {
  if (!config().writable)
    throw new MessagingError(
      "Messaging is read-only until it is explicitly enabled on this server.",
      403,
    );
}
export function businessAddress(channel: string) {
  const value = Deno.env.get(
    channel === "email" ? "INVOICE_FROM_EMAIL" : "TWILIO_FROM_NUMBER",
  );
  if (!value && !config().dry_run)
    throw new MessagingError(
      "The sending address or number is not configured.",
      503,
    );
  return value ? (channel === 'email' ? emailSenderAddress(value) : normalizeAddress(channel, value)) : "sandbox";
}
export async function conversation(
  channel: string,
  to: string,
  customerId?: string,
  id?: string,
) {
  const address = normalizeAddress(channel, to),
    business = businessAddress(channel);
  if (id) {
    const row = checked(
      await service
        .from("messaging_conversations")
        .select("*")
        .eq("id", id)
        .single(),
    );
    if (
      !row ||
      row.channel !== channel ||
      row.address !== address ||
      row.business_address !== business
    )
      throw new MessagingError(
        "Conversation does not match this recipient or sending account.",
      );
    return row;
  }
  const query = () =>
    service
      .from("messaging_conversations")
      .select("*")
      .eq("channel", channel)
      .eq("address", address)
      .eq("business_address", business);
  const existing = checked(await query().maybeSingle());
  if (existing && (!customerId || existing.customer_id)) return existing;
  let name = address;
  if (!customerId)
    customerId =
      checked(
        await service.rpc("messaging_find_customer", {
          p_channel: channel,
          p_address: address,
        }),
      ) || undefined;
  if (customerId) {
    const customer = checked(
      await service
        .from("customers")
        .select("name,company_name")
        .eq("id", customerId)
        .single(),
    );
    name = customer.company_name || customer.name || address;
  }
  if (existing) {
    checked(
      await service
        .from("messaging_conversations")
        .update({ customer_id: customerId, display_name: name })
        .eq("id", existing.id),
    );
    return { ...existing, customer_id: customerId, display_name: name };
  }
  checked(
    await service
      .from("messaging_conversations")
      .upsert(
        {
          channel,
          address,
          business_address: business,
          customer_id: customerId || null,
          display_name: name,
        },
        {
          onConflict: "channel,address,business_address",
          ignoreDuplicates: true,
        },
      ),
  );
  return checked(await query().single());
}
export async function send(input: SendInput, claims: Record<string, unknown>) {
  writable();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.request_id || ""))
    throw new MessagingError("A request ID is required.");
  const channel = input.channel,
    to = normalizeAddress(channel, input.to),
    settings = config();
  const testRestricted=!!(settings.test_email_to||settings.test_sms_to);
  if(testRestricted && (channel==='email' ? to!==settings.test_email_to : to!==settings.test_sms_to))
    throw new MessagingError('Sending is restricted to the configured test recipients.',403);
  if (!(channel === "email" ? settings.email_ready : settings.sms_ready))
    throw new MessagingError(
      "Sending is not enabled or provider configuration is incomplete.",
      503,
    );
  if (
    String(input.body || "").length > 10000 ||
    String(input.subject || "").length > 200
  )
    throw new MessagingError("Message or subject is too long.");
  if (channel === "email" && !input.subject?.trim())
    throw new MessagingError("Enter an email subject.");
  const files = input.attachments || [];
  if (!Array.isArray(files) || files.length > 5)
    throw new MessagingError("Attach up to five files.");
  const decoded = files.map(decodeAttachment);
  if (decoded.reduce((n, b) => n + b.length, 0) > MAX_ATTACHMENT_BYTES)
    throw new MessagingError("Attachments must total 4 MB or less.");
  if (!input.body?.trim() && !files.length)
    throw new MessagingError("Write a message or attach a file.");
  // Generated PDFs have volatile metadata. A request ID represents one user
  // intent, including retry after an uncertain response, not a new PDF render.
  const fingerprint = JSON.stringify({
    channel,
    to,
    body: input.body,
    subject: input.subject || "",
    invoice: input.invoice_id || "",
    files: files.map((f) => ({ name: f.name, type: f.type })),
    customer: input.customer_id || "",
  });
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(fingerprint),
      ),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  const priorQuery = () =>
    service
      .from("messaging_messages")
      .select("*")
      .eq("sent_by", claims.sub)
      .eq("request_id", input.request_id);
  const prior = checked(await priorQuery().maybeSingle());
  if (prior) {
    if (prior.request_hash !== hash)
      throw new MessagingError(
        "This request was used for different content. Open a new message.",
        409,
      );
    return { ok: true, message: prior, dry_run: prior.dry_run };
  }
  const conv = await conversation(
    channel,
    to,
    input.customer_id,
    input.conversation_id,
  );
  if (conv.blocked || conv.opted_out)
    throw new MessagingError("Sending is blocked for this conversation.", 409);
  const id = crypto.randomUUID();
  const record = {
    id,
    conversation_id: conv.id,
    invoice_id: input.invoice_id || null,
    direction: "outbound",
    channel,
    body: input.body || "",
    subject: input.subject || "",
    status: "preparing",
    provider: channel === "email" ? "resend" : "twilio",
    request_id: input.request_id,
    request_hash: hash,
    sent_by: claims.sub,
    sent_by_name: claims.name || "Office",
    dry_run: settings.dry_run,
  };
  const inserted = await service.from("messaging_messages").insert(record);
  if (inserted.error?.code === "23505") {
    const winner = checked(await priorQuery().single());
    if (winner.request_hash !== hash)
      throw new MessagingError("Conflicting send request.", 409);
    return { ok: true, message: winner, dry_run: winner.dry_run };
  }
  checked(inserted);
  let providerStarted = false;
  try {
    const attachments = [],
      mediaUrls = [];
    for (let i = 0; i < files.length; i++) {
      const name = mediaFilename(files[i].name, i),
        path = `${id}/${i}/${name}`;
      checked(
        await service.storage
          .from("message-attachments")
          .upload(path, decoded[i], {
            contentType: files[i].type,
            upsert: false,
          }),
      );
      const signed = checked(
        await service.storage
          .from("message-attachments")
          .createSignedUrl(path, 60 * 60 * 24 * 30),
      );
      attachments.push({
        path,
        name,
        type: files[i].type,
        size: decoded[i].length,
      });
      mediaUrls.push(signed.signedUrl);
    }
    checked(
      await service
        .from("messaging_messages")
        .update({ attachments })
        .eq("id", id),
    );
    if (settings.dry_run) {
      checked(
        await service
          .from("messaging_messages")
          .update({ status: "simulated", status_at: new Date().toISOString() })
          .eq("id", id),
      );
    } else {
      const current = checked(
        await service
          .from("messaging_conversations")
          .select("blocked,opted_out")
          .eq("id", conv.id)
          .single(),
      );
      if (current.blocked || current.opted_out)
        throw new MessagingError(
          "Sending is blocked for this conversation.",
          409,
        );
      let url: string;
      let init: RequestInit;
      if (channel === "email") {
        const rows = checked(await service.from("settings").select("company_profile").limit(1));
        const company = rows?.[0]?.company_profile || {};
        url = "https://api.resend.com/emails";
        init = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
            "Content-Type": "application/json",
            "Idempotency-Key": id,
          },
          body: JSON.stringify({
            from: company.company_name ? `${JSON.stringify(company.company_name)} <${businessAddress(channel)}>` : businessAddress(channel),
            to: [to],
            subject: input.subject,
            text: input.body || "Attachment",
            reply_to: company.email || businessAddress(channel),
            attachments: files.map((f, i) => ({
              filename: mediaFilename(f.name, i),
              content: f.content,
            })),
          }),
        };
      } else {
        const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
        url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
        const params = new URLSearchParams({
          From: businessAddress(channel),
          ...(Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') ? {MessagingServiceSid:Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')!} : {}),
          To: to,
          Body: input.body || "",
          StatusCallback: `${Deno.env.get("SUPABASE_URL")}/functions/v1/messaging-twilio?message_id=${id}`,
        });
        mediaUrls.forEach((u) => params.append("MediaUrl", u));
        init = {
          method: "POST",
          headers: {
            Authorization:
              "Basic " + btoa(`${sid}:${Deno.env.get("TWILIO_AUTH_TOKEN")}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params,
        };
      }
      providerStarted = true;
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status >= 500)
          throw new Error("Provider response uncertain.");
        providerStarted = false;
        throw new MessagingError(
          `Provider rejected the message${data.code ? ` (${data.code})` : ""}. Check sender setup and recipient.`,
          502,
        );
      }
      const providerId = channel === "email" ? data.id : data.sid;
      if (!providerId)
        throw new Error("Provider response did not contain a message ID.");
      // A callback may already have moved this row forward.
      checked(
        await service
          .from("messaging_messages")
          .update({ provider_id: providerId })
          .eq("id", id),
      );
      checked(
        await service
          .from("messaging_messages")
          .update({ status: "queued", status_at: new Date().toISOString() })
          .eq("id", id)
          .eq("status", "preparing"),
      );
      checked(
        await service.rpc("messaging_reconcile", {
          p_provider: record.provider,
          p_provider_id: providerId,
        }),
      );
    }
  } catch (e) {
    const message = providerStarted
      ? "Delivery outcome is uncertain. Check provider logs before resending."
      : (e as Error).message;
    checked(
      await service
        .from("messaging_messages")
        .update({
          status: providerStarted ? "unknown" : "failed",
          error: message,
          status_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "preparing"),
    );
  }
  const result = checked(
    await service.from("messaging_messages").select("*").eq("id", id).single(),
  );
  return { ok: true, message: result, dry_run: settings.dry_run };
}
export async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new MessagingError("Request body required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 6 * 1024 * 1024) {
      await reader.cancel();
      throw new MessagingError("Request too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MessagingError("Invalid JSON.");
  }
}
