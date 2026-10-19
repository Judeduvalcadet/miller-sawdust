import { service, json } from "../_shared/mod.ts";
import { checked, conversation, writable } from "../_shared/messaging.ts";
import {
  MAX_ATTACHMENT_BYTES,
  MEDIA_TYPES,
  normalizeAddress,
  optOutChange,
  receiptStatus,
} from "../_shared/messaging-core.ts";
import { validTwilio } from "../_shared/messaging-webhooks.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("POST required", { status: 405 });
  try {
    const url = new URL(req.url),
      raw = await req.text();
    if (raw.length > 100000) return new Response("Too large", { status: 413 });
    const params = Object.fromEntries(new URLSearchParams(raw));
    // Use the canonical external URL, never a proxy-controlled Host header.
    const external = `${Deno.env.get("SUPABASE_URL")}/functions/v1/messaging-twilio${url.search}`;
    if (
      !validTwilio(
        Deno.env.get("TWILIO_AUTH_TOKEN") || "",
        req.headers.get("x-twilio-signature") || "",
        external,
        params,
      )
    )
      return new Response("Forbidden", { status: 403 });
    if (params.AccountSid !== Deno.env.get("TWILIO_ACCOUNT_SID"))
      return new Response("Forbidden", { status: 403 });
    writable();
    const sid = params.MessageSid;
    if (
      !/^SM[0-9a-f]{32}$/i.test(sid || "") &&
      !/^MM[0-9a-f]{32}$/i.test(sid || "")
    )
      return new Response("Invalid message ID", { status: 400 });
    if (url.searchParams.has("message_id")) {
      const status = receiptStatus("twilio", params.MessageStatus);
      if (!status) return new Response("OK");
      const messageId = url.searchParams.get("message_id")!;
      const message = checked(
        await service
          .from("messaging_messages")
          .select("id,provider_id,provider,direction")
          .eq("id", messageId)
          .single(),
      );
      if (
        message.provider !== "twilio" ||
        message.direction !== "outbound" ||
        (message.provider_id && message.provider_id !== sid)
      )
        return new Response("Invalid message", { status: 400 });
      checked(
        await service
          .from("messaging_messages")
          .update({ provider_id: sid })
          .eq("id", messageId)
          .is("provider_id", null),
      );
      checked(
        await service
          .from("messaging_events")
          .upsert(
            {
              provider: "twilio",
              event_id: `${sid}:${params.MessageStatus}:${params.ErrorCode || ""}`,
              provider_id: sid,
              status,
              error: params.ErrorCode
                ? `Twilio error ${params.ErrorCode}`
                : null,
              occurred_at: new Date().toISOString(),
            },
            { onConflict: "provider,event_id", ignoreDuplicates: true },
          ),
      );
      checked(
        await service.rpc("messaging_reconcile", {
          p_provider: "twilio",
          p_provider_id: sid,
        }),
      );
      return new Response("OK");
    }
    const configured = Deno.env.get("TWILIO_FROM_NUMBER");
    if (
      !configured ||
      normalizeAddress("sms", params.To) !== normalizeAddress("sms", configured)
    )
      return new Response("Unknown recipient", { status: 400 });
    const prior = checked(
      await service
        .from("messaging_messages")
        .select("id")
        .eq("provider", "twilio")
        .eq("provider_id", sid)
        .maybeSingle(),
    );
    if (prior)
      return new Response("<Response/>", {
        headers: { "Content-Type": "text/xml" },
      });
    const from = normalizeAddress("sms", params.From);
    const conv = await conversation("sms", from);
    const optedOut = optOutChange(params.Body || "", params.OptOutType);
    if (optedOut !== null)
      checked(
        await service
          .from("messaging_conversations")
          .update({ opted_out: optedOut })
          .eq("id", conv.id),
      );
    const media = [];
    const count = Number(params.NumMedia || 0);
    if (!Number.isInteger(count) || count < 0 || count > 10)
      return new Response("Invalid media count", { status: 400 });
    for (let i = 0; i < count; i++) {
      const type = params[`MediaContentType${i}`] || "application/octet-stream";
      if (!MEDIA_TYPES.includes(type)) {
        media.push({
          name: `Attachment ${i + 1}`,
          type,
          error: "Unsupported media type",
        });
        continue;
      }
      const mediaUrl = new URL(params[`MediaUrl${i}`]);
      const account = Deno.env.get("TWILIO_ACCOUNT_SID")!;
      if (
        mediaUrl.protocol !== "https:" ||
        mediaUrl.hostname !== "api.twilio.com" ||
        !mediaUrl.pathname.startsWith(
          `/2010-04-01/Accounts/${account}/Messages/${sid}/Media/`,
        )
      )
        return new Response("Invalid media URL", { status: 400 });
      // Fetch only signed, account-scoped Twilio media. Fetch strips Basic Auth
      // on cross-origin redirects. No client-supplied fetch URLs are accepted.
      const response = await fetch(mediaUrl, {
        headers: {
          Authorization:
            "Basic " + btoa(`${account}:${Deno.env.get("TWILIO_AUTH_TOKEN")}`),
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Media download failed");
      const reader = response.body!.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_ATTACHMENT_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      if (size > MAX_ATTACHMENT_BYTES) {
        media.push({
          name: `Attachment ${i + 1}`,
          type,
          error: "Attachment exceeds 4 MB",
        });
        continue;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const ext = (
        {
          "application/pdf": "pdf",
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/gif": "gif",
          "image/webp": "webp",
          "audio/mpeg": "mp3",
          "audio/ogg": "ogg",
          "video/mp4": "mp4",
        } as Record<string, string>
      )[type];
      const name = `attachment-${i + 1}.${ext}`,
        path = `inbound/${sid}/${name}`;
      checked(
        await service.storage
          .from("message-attachments")
          .upload(path, bytes, { contentType: type, upsert: true }),
      );
      media.push({ name, path, type, size });
    }
    const inserted = await service
      .from("messaging_messages")
      .insert({
        conversation_id: conv.id,
        direction: "inbound",
        channel: "sms",
        body: String(params.Body || "").slice(0, 10000),
        status: "received",
        provider: "twilio",
        provider_id: sid,
        attachments: media,
      });
    if (inserted.error?.code !== "23505") checked(inserted);
    return new Response("<Response/>", {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (e) {
    console.error(
      "Messaging callback failed",
      e instanceof Error ? e.message : "unknown",
    );
    return json(503, { error: "Callback could not be recorded. Retry later." });
  }
});
