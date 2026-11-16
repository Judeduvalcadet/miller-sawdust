import {
  normalizeAddress,
  emailSenderAddress,
  decodeAttachment,
  MAX_ATTACHMENT_BYTES,
  receiptStatus,
  optOutChange,
  mediaFilename,
} from "../supabase/functions/_shared/messaging-core.ts";

Deno.test('Sender configuration accepts display names without duplicating or trusting header fields', () => {
  eq(emailSenderAddress('Company B <invoices@mail.company-b.example.com>'), 'invoices@mail.company-b.example.com');
  eq(emailSenderAddress('invoices@mail.company-b.example.com'), 'invoices@mail.company-b.example.com');
  throws(() => emailSenderAddress('office@example.com\r\nBcc: private@example.com'));
});
import {
  validTwilio,
  verifiedResend,
} from "../supabase/functions/_shared/messaging-webhooks.ts";
import { getExpectedTwilioSignature } from "npm:twilio@5.10.4/lib/webhooks/webhooks.js";
import { Webhook } from "npm:svix@1.76.1/dist/webhook.js";

function eq(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
function throws(fn: () => unknown) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected rejection");
}
Deno.test(
  "normalizes US and international recipients without double country code",
  () => {
    eq(normalizeAddress("sms", "330-555-1234"), "+13305551234");
    eq(normalizeAddress("sms", "1 (330) 555-1234"), "+13305551234");
    eq(normalizeAddress("sms", "+44 20 7123 4567"), "+442071234567");
    eq(
      normalizeAddress("email", " Billing@Example.com "),
      "billing@example.com",
    );
    for (const value of [
      "555",
      "3305551234 ext 9",
      "++13305551234",
      "+00012345678",
    ])
      throws(() => normalizeAddress("sms", value));
    throws(() =>
      normalizeAddress("email", "x@example.com\nBcc: victim@example.com"),
    );
  },
);
Deno.test("validates attachment type, PDF content and size", () => {
  eq(
    decodeAttachment({
      name: "invoice.pdf",
      type: "application/pdf",
      content: btoa("%PDF-1.4\n"),
    }).length,
    9,
  );
  throws(() =>
    decodeAttachment({
      name: "invoice.pdf",
      type: "application/pdf",
      content: btoa("<html>bad</html>"),
    }),
  );
  throws(() =>
    decodeAttachment({
      name: "x.html",
      type: "text/html",
      content: btoa("test"),
    }),
  );
  throws(() =>
    decodeAttachment({
      name: "x.png",
      type: "image/png",
      content: "!invalid!",
    }),
  );
  throws(() =>
    decodeAttachment({
      name: "x.png",
      type: "image/png",
      content: "a".repeat(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 1),
    }),
  );
  eq(mediaFilename("Invoice 10482.pdf"), "Invoice 10482.pdf");
  eq(mediaFilename("../../Invoice 10482.pdf"), "Invoice 10482.pdf");
  eq(mediaFilename("Invoice\r\n10482.pdf"), "Invoice__10482.pdf");
  eq(mediaFilename(""), "attachment-1.bin");
});
Deno.test("receipts do not confuse accepted or opened with delivered", () => {
  eq(receiptStatus("twilio", "queued"), "queued");
  eq(receiptStatus("twilio", "delivered"), "delivered");
  eq(receiptStatus("resend", "email.sent"), "sent");
  eq(receiptStatus("resend", "email.delivered"), "delivered");
  eq(receiptStatus("resend", "email.opened"), null);
  eq(receiptStatus("twilio", "read"), null);
  eq(receiptStatus("resend", "email.bounced"), "bounced");
});
Deno.test(
  "opt-out keywords and provider signals, without treating any YES as consent",
  () => {
    eq(optOutChange(" stop "), true);
    eq(optOutChange("please help", "STOP"), true);
    eq(optOutChange("START"), false);
    eq(optOutChange("yes"), null);
    eq(optOutChange("HELP"), null);
  },
);
Deno.test(
  "Twilio signature covers exact URL, body and extra provider fields",
  () => {
    const token = "test-only-token",
      url = "https://example.com/functions/v1/messaging-twilio?message_id=123";
    const params = {
      MessageSid: "SM123",
      Body: "Hello",
      FutureParameter: "included",
    };
    const signature = getExpectedTwilioSignature(token, url, params);
    eq(validTwilio(token, signature, url, params), true);
    eq(
      validTwilio(token, signature, url, { ...params, Body: "Tampered" }),
      false,
    );
    eq(validTwilio(token, signature, url.replace("123", "456"), params), false);
    eq(validTwilio(token, "", url, params), false);
  },
);
Deno.test("Resend signature rejects tampering and expired timestamps", () => {
  const secret = "whsec_" + btoa("a".repeat(32)),
    wh = new Webhook(secret);
  const payload = JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: { email_id: "test-id" },
  });
  const now = new Date(),
    id = "evt_test";
  const headers = new Headers({
    "svix-id": id,
    "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
    "svix-signature": wh.sign(id, now, payload),
  });
  eq(verifiedResend(secret, payload, headers).type, "email.delivered");
  throws(() =>
    verifiedResend(secret, payload.replace("delivered", "bounced"), headers),
  );
  const old = new Date(Date.now() - 3600000);
  headers.set("svix-timestamp", String(Math.floor(old.getTime() / 1000)));
  headers.set("svix-signature", wh.sign(id, old, payload));
  throws(() => verifiedResend(secret, payload, headers));
});

Deno.test("contact guards reject incomplete US numbers and malformed email addresses", () => {
  for (const phone of ['33055512', '330555123', '+133055512', '330555123456', '330abc1234']) throws(() => normalizeAddress('sms', phone));
  for (const email of ['jude@', 'jude@example', 'jude..cadet@example.com', 'jude@example..com', 'jude@example.com,other@example.com', 'jude@-example.com']) throws(() => normalizeAddress('email', email));
  eq(normalizeAddress('sms', '(330) 600-1079'), '+13306001079');
  eq(normalizeAddress('email', 'jude+invoice@example.com'), 'jude+invoice@example.com');
});
