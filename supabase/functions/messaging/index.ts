import { DEFAULT_EMAIL_TEMPLATE, validateEmailTemplate } from "../_shared/email-template.ts";
import { service, json, handleOptions } from "../_shared/mod.ts";
import {
  checked,
  config,
  conversation,
  MessagingError,
  office,
  readBody,
  send,
  writable,
} from "../_shared/messaging.ts";
Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json(405, { error: "POST required." });
  try {
    const claims = await office(req),
      body = await readBody(req);
    if (body.action === "status") return json(200, config());
    if (["email_template", "save_email_template"].includes(body.action)) {
      const rows = checked(await service.from("settings").select("id,email_template").limit(1));
      if (body.action === "email_template") return json(200, { template: rows?.[0]?.email_template || DEFAULT_EMAIL_TEMPLATE });
      writable();
      if (claims.app_role !== "admin") throw new MessagingError("Only an administrator can change email templates.", 403);
      const template = validateEmailTemplate(body.template);
      checked(rows?.[0]?.id
        ? await service.from("settings").update({ email_template: template }).eq("id", rows[0].id)
        : await service.from("settings").insert({ email_template: template }));
      return json(200, { template });
    }
    if (body.action === "email_config") return json(200, {
      ...config(),
      provider: "Resend API",
      sender: Deno.env.get("INVOICE_FROM_EMAIL") || null,
      api_key_configured: !!Deno.env.get("RESEND_API_KEY"),
      webhook_configured: !!Deno.env.get("RESEND_WEBHOOK_SECRET") || !!Deno.env.get('RESEND_RELAY_WEBHOOK_SECRET'),
      sender_configured: !!Deno.env.get("INVOICE_FROM_EMAIL"),
    });
    if (body.action === "attachment") {
      const message = checked(
        await service
          .from("messaging_messages")
          .select("attachments")
          .eq("id", body.message_id)
          .single(),
      );
      const file = message.attachments[Number(body.index)];
      if (!file?.path)
        throw new MessagingError("Attachment is unavailable.", 404);
      const signed = checked(
        await service.storage
          .from("message-attachments")
          .createSignedUrl(file.path, 300, { download: file.name }),
      );
      return json(200, { url: signed.signedUrl });
    }
    writable();
    if (body.action === "start")
      return json(200, {
        conversation: await conversation(
          body.channel,
          body.to,
          body.customer_id,
        ),
      });
    if (body.action === "update") {
      const patch: Record<string, unknown> = {};
      if (typeof body.archived === "boolean") patch.archived = body.archived;
      if (typeof body.blocked === "boolean") patch.blocked = body.blocked;
      if (typeof body.read_at === "string") {
        const time = new Date(body.read_at).getTime();
        if (!Number.isFinite(time))
          throw new MessagingError("Invalid read timestamp.");
        patch.read_at = new Date(Math.min(time, Date.now())).toISOString();
      }
      if (!Object.keys(patch).length)
        throw new MessagingError("No changes supplied.");
      checked(
        await service
          .from("messaging_conversations")
          .update(patch)
          .eq("id", body.conversation_id),
      );
      return json(200, { ok: true });
    }
    if (body.action === "send") {
      if (body.invoice_id)
        throw new MessagingError("Use invoice sending for invoices.");
      return json(200, await send(body, claims));
    }
    throw new MessagingError("Unknown action.");
  } catch (e) {
    return json(e instanceof MessagingError ? e.status : 400, {
      error: (e as Error).message,
    });
  }
});
