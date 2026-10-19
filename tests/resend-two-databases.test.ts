// Real local databases, production handler code, synthetic signed events only.
// No Resend API calls and no outbound email/text messages.
import { createClient } from "npm:@supabase/supabase-js@2.49.0";
import { Webhook } from "npm:svix@1.76.1/dist/webhook.js";
import { createResendRouter } from "../production-gateway/supabase/functions/_shared/resend-router.ts";
import { createReceiptStore } from "../production-gateway/supabase/functions/_shared/resend-store.ts";
import { createResendReceiptHandler } from "../supabase/functions/_shared/resend-receipt.ts";
const assert = (v: unknown, message = "Assertion failed") => {
  if (!v) throw Error(message);
};
const checked = (r: any) => {
  if (r.error) throw Error("Local fixture operation failed: " + r.error.code);
  return r.data;
};
const secret = () => "whsec_" + btoa(crypto.randomUUID() + crypto.randomUUID());
async function localKeys(container: string) {
  const r = await new Deno.Command("docker", {
    args: ["inspect", container],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(r.success);
  return Object.fromEntries(
    JSON.parse(new TextDecoder().decode(r.stdout))[0].Config.Env.map(
      (e: string) => {
        const i = e.indexOf("=");
        return [e.slice(0, i), e.slice(i + 1)];
      },
    ),
  );
}
const aKeys = await localKeys("supabase_edge_runtime_miller-sawdust"),
  bKeys = await localKeys("supabase_edge_runtime_jobyard-company-b");
assert(aKeys.APP_ENV === "sandbox" && bKeys.APP_ENV === "sandbox");
const a = createClient(
    "http://127.0.0.1:54521",
    aKeys.SUPABASE_SERVICE_ROLE_KEY,
  ),
  b = createClient("http://127.0.0.1:54621", bKeys.SUPABASE_SERVICE_ROLE_KEY);
const senderA = "invoices@mail.company-a.example.com",
  senderB = "invoices@mail.company-b.example.com";
const primary = secret(),
  keyA = secret(),
  keyB = secret(),
  retryKey = crypto.randomUUID() + crypto.randomUUID();
const receiveA = createResendReceiptHandler({
  db: a,
  primarySecret: primary,
  relaySecret: keyA,
  sender: `Company A <${senderA}>`,
  writable: () => {},
});
const receiveB = createResendReceiptHandler({
  db: b,
  primarySecret: primary,
  relaySecret: keyB,
  sender: senderB,
  writable: () => {},
});
function signed(body: any, key: string, id = "msg_" + crypto.randomUUID()) {
  const raw = JSON.stringify(body), now = new Date();
  return new Request("https://gateway.example.com/resend-router", {
    method: "POST",
    body: raw,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
      "svix-signature": new Webhook(key).sign(id, now, raw),
    },
  });
}
async function fixtures(fn: (ids: any) => Promise<void>) {
  const provider = "email_" + crypto.randomUUID(),
    eventIds: string[] = [],
    messages: any[] = [];
  try {
    for (const [db, sender] of [[a, senderA], [b, senderB]] as const) {
      const conv = checked(
        await db.from("messaging_conversations").insert({
          channel: "email",
          address: provider + "@example.com",
          business_address: sender,
        }).select().single(),
      );
      const message = checked(
        await db.from("messaging_messages").insert({
          conversation_id: conv.id,
          direction: "outbound",
          channel: "email",
          body: "TEST ONLY",
          subject: "TEST ONLY",
          status: "queued",
          provider: "resend",
          provider_id: provider,
        }).select().single(),
      );
      messages.push({ db, conv: conv.id, id: message.id });
    }
    await fn({ provider, messages, eventIds });
  } finally {
    for (const m of messages) {
      checked(
        await m.db.from("messaging_events").delete().eq(
          "provider_id",
          provider,
        ),
      );
      checked(await m.db.from("messaging_messages").delete().eq("id", m.id));
      checked(
        await m.db.from("messaging_conversations").delete().eq("id", m.conv),
      );
    }
    checked(
      await a.from("email_gateway_receipts").delete().eq("email_id", provider),
    );
  }
}
const status = async (m: any) =>
  checked(
    await m.db.from("messaging_messages").select("status").eq("id", m.id)
      .single(),
  ).status;
Deno.test("Shared router and real receipt handlers update only the matching database, even with identical provider IDs", async () => {
  await fixtures(async ({ provider, messages }) => {
    const routes = {
      "mail.company-a.example.com": {
        company: "a",
        endpoint: "https://a.example.com/receipt",
        secret: keyA,
      },
      "mail.company-b.example.com": {
        company: "b",
        endpoint: "https://b.example.com/receipt",
        secret: keyB,
      },
    };
    const handler = createResendRouter({
      secret: primary,
      retryKey,
      routes,
      store: createReceiptStore(a),
      fetcher: (async (url, init) =>
        String(url) === routes["mail.company-a.example.com"].endpoint
          ? receiveA(new Request(String(url), init))
          : receiveB(new Request(String(url), init))) as typeof fetch,
    });
    const event = (from: string) => ({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: {
        email_id: provider,
        from,
        to: ["private@example.com"],
        subject: "Private invoice",
      },
    });
    const first = signed(event(senderA), primary), duplicate = first.clone();
    assert((await handler(first)).status === 200);
    assert(await status(messages[0]) === "delivered");
    assert(
      await status(messages[1]) === "queued",
      "Company B was changed by Company A receipt",
    );
    assert((await handler(duplicate)).status === 200);
    assert((await handler(signed(event(senderB), primary))).status === 200);
    assert(await status(messages[1]) === "delivered");
    for (const m of messages) {
      assert(
        checked(
          await m.db.from("messaging_events").select("id").eq(
            "provider_id",
            provider,
          ),
        ).length === 1,
        "Duplicate or foreign receipt was persisted",
      );
    }
  });
});
Deno.test("A valid team-wide direct webhook for another company cannot enter this installation", async () => {
  await fixtures(async ({ provider, messages }) => {
    const r = await receiveA(
      signed({
        type: "email.delivered",
        created_at: new Date().toISOString(),
        data: { email_id: provider, from: `Company B <${senderB}>` },
      }, primary),
    );
    assert(r.status === 200);
    for (const m of messages) {
      assert(await status(m) === "queued");
      assert(
        checked(
          await m.db.from("messaging_events").select("id").eq(
            "provider_id",
            provider,
          ),
        ).length === 0,
      );
    }
  });
});
Deno.test("Another company relay key and a forged sender binding cannot update delivery state", async () => {
  await fixtures(async ({ provider, messages }) => {
    const data = {
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: provider, sender_domain: "mail.company-a.example.com" },
    };
    assert((await receiveA(signed(data, keyB))).status === 403);
    data.data.sender_domain = "mail.company-b.example.com";
    assert((await receiveA(signed(data, keyA))).status === 200);
    assert(await status(messages[0]) === "queued");
  });
});
Deno.test("A failed delivery remains durable; recovery updates the right database exactly once", async () => {
  await fixtures(async ({ provider, messages }) => {
    let offline = true;
    const handler = createResendRouter({
      secret: primary,
      retryKey,
      routes: {
        "mail.company-b.example.com": {
          company: "b",
          endpoint: "https://b.example.com/receipt",
          secret: keyB,
        },
      },
      store: createReceiptStore(a),
      fetcher: (async (url, init) =>
        offline
          ? new Response("Unavailable", { status: 503 })
          : receiveB(new Request(String(url), init))) as typeof fetch,
    });
    const request = signed({
        type: "email.delivered",
        created_at: new Date().toISOString(),
        data: { email_id: provider, from: senderB },
      }, primary),
      duplicate = request.clone();
    assert((await handler(request)).status === 503);
    assert(await status(messages[1]) === "queued");
    const pending = checked(
      await a.from("email_gateway_receipts").select("*").eq(
        "email_id",
        provider,
      ),
    );
    assert(pending.length === 1 && !pending[0].delivered_at);
    offline = false;
    assert((await handler(duplicate)).status === 200);
    assert(await status(messages[1]) === "delivered");
    assert(await status(messages[0]) === "queued");
    assert(
      checked(
        await a.from("email_gateway_receipts").select("*").eq(
          "email_id",
          provider,
        ),
      )[0].delivered_at,
    );
  });
});
Deno.test("Anonymous callers cannot read or alter the shared receipt inbox in the database", async () => {
  const anon = createClient("http://127.0.0.1:54521", aKeys.SUPABASE_ANON_KEY);
  const r = await anon.from("email_gateway_receipts").select("*");
  assert(!!r.error && [401, 403].includes(r.status));
});
