import { Webhook } from "npm:svix@1.76.1/dist/webhook.js";
import {
  createResendRouter,
  type EmailRoute,
  type Receipt,
  type ReceiptStore,
  senderDomain,
} from "../production-gateway/supabase/functions/_shared/resend-router.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw Error(message);
}
const key = () => "whsec_" + btoa(crypto.randomUUID() + crypto.randomUUID());
const secret = key(), retryKey = crypto.randomUUID() + crypto.randomUUID();
function store() {
  const rows = new Map<string, Receipt>();
  const value: ReceiptStore = {
    async save(row) {
      const old = rows.get(row.event_id);
      if (
        old &&
        ["sender_domain", "email_id", "event_type", "occurred_at"].some((k) =>
          (old as any)[k] !== (row as any)[k]
        )
      ) throw Error("Changed identity");
      if (!old) rows.set(row.event_id, { ...row });
      return rows.get(row.event_id)!;
    },
    async pending(domains, perDomain) {
      return domains.flatMap((domain) =>
        [...rows.values()].filter((r) =>
          r.sender_domain === domain && !r.delivered_at
        ).slice(0, perDomain)
      );
    },
    async delivered(id) {
      rows.get(id)!.delivered_at = new Date().toISOString();
    },
  };
  return { rows, value };
}
function request(
  domain: string,
  id = "msg_" + crypto.randomUUID(),
  extra = {},
  signKey = secret,
  ago = 0,
) {
  const body = JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: {
      email_id: "email_" + id,
      from: `Company <office@${domain}>`,
      to: ["private@example.com"],
      subject: "Private invoice",
      ...extra,
    },
  });
  const now = new Date(Date.now() - ago);
  return new Request("https://gateway.example.com/receipt?company=attacker", {
    method: "POST",
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
      "svix-signature": new Webhook(signKey).sign(id, now, body),
    },
  });
}
const retry = (provided = retryKey) =>
  new Request("https://gateway.example.com/receipt?action=retry", {
    method: "POST",
    headers: { "x-jobyard-retry-key": provided },
  });
Deno.test("80 independent sender domains deliver only to their registered company and expose no recipients/content", async () => {
  const s = store(),
    routes: Record<string, EmailRoute> = {},
    databases = new Map<string, Map<string, string>>();
  for (let i = 0; i < 80; i++) {
    const endpoint = `https://company-${i}.example.com/receipt`;
    routes[`mail.company-${i}.example.com`] = {
      company: "company_" + i,
      endpoint,
      secret: key(),
    };
    databases.set(endpoint, new Map());
  }
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const route = Object.values(routes).find((r) =>
      r.endpoint === String(url)
    )!;
    assert(route, "Unregistered destination");
    assert(init?.redirect === "error");
    const headers = new Headers(init.headers),
      event = new Webhook(route.secret).verify(
        String(init.body),
        Object.fromEntries(headers),
      ) as any;
    assert(
      !("to" in event.data) && !("subject" in event.data) &&
        !("from" in event.data),
    );
    assert(!String(init.body).includes("private@example.com"));
    databases.get(String(url))!.set(
      headers.get("svix-id")!,
      event.data.email_id,
    );
    return new Response("OK");
  }) as typeof fetch;
  const handler = createResendRouter({
    secret,
    retryKey,
    routes,
    store: s.value,
    fetcher,
  });
  for (let i = 0; i < 80; i++) {
    assert(
      (await handler(
        request(`mail.company-${i}.example.com`, "msg_company_" + i),
      )).status === 200,
    );
  }
  for (let i = 0; i < 80; i++) {
    const rows = databases.get(
      routes[`mail.company-${i}.example.com`].endpoint,
    )!;
    assert(rows.size === 1);
    assert(rows.get("msg_company_" + i) === "email_msg_company_" + i);
  }
  assert([...s.rows.values()].every((r) => r.delivered_at));
});
Deno.test("Invalid, tampered and expired signatures cannot write to the inbox", async () => {
  const s = store(),
    handler = createResendRouter({
      secret,
      retryKey,
      routes: {},
      store: s.value,
    });
  for (
    const r of [
      request("company.example.com", undefined, {}, key()),
      request("company.example.com", undefined, {}, secret, 600000),
      new Request("https://gateway.example.com", {
        method: "POST",
        body: "{}",
      }),
    ]
  ) assert((await handler(r)).status === 403);
  const valid = request("company.example.com"),
    tampered = new Request(valid.url, {
      method: "POST",
      headers: valid.headers,
      body: (await valid.text()).replace(
        "company.example.com",
        "attacker.example.com",
      ),
    });
  assert((await handler(tampered)).status === 403);
  assert(s.rows.size === 0);
});
Deno.test("An unknown company stays quarantined and can be delivered after approved onboarding", async () => {
  const s = store();
  let deliveries = 0;
  const handler = createResendRouter({
    secret,
    retryKey,
    routes: {},
    store: s.value,
  });
  assert((await handler(request("new-company.example.com"))).status === 202);
  assert(s.rows.size === 1 && ![...s.rows.values()][0].delivered_at);
  const configured = createResendRouter({
    secret,
    retryKey,
    store: s.value,
    routes: {
      "new-company.example.com": {
        company: "new_company",
        endpoint: "https://new-company.example.com/receipt",
        secret: key(),
      },
    },
    fetcher: (async () => {
      deliveries++;
      return new Response("OK");
    }) as typeof fetch,
  });
  assert((await configured(retry())).status === 200);
  assert(deliveries === 1);
  assert([...s.rows.values()][0].delivered_at);
});
Deno.test("One failing company retains receipts without preventing another company delivery; recovery is idempotent", async () => {
  const s = store(),
    routes = {
      "a.example.com": {
        company: "a",
        endpoint: "https://a.example.com/receipt",
        secret: key(),
      },
      "b.example.com": {
        company: "b",
        endpoint: "https://b.example.com/receipt",
        secret: key(),
      },
    };
  let failing = true;
  const successful = new Map<string, number>();
  const handler = createResendRouter({
    secret,
    retryKey,
    routes,
    store: s.value,
    fetcher: (async (url, init) => {
      if (String(url).includes("a.example.com") && failing) {
        throw TypeError("Receiver unavailable");
      }
      const id = new Headers(init?.headers).get("svix-id")!;
      successful.set(id, (successful.get(id) || 0) + 1);
      return new Response("OK");
    }) as typeof fetch,
  });
  const a = request("a.example.com", "msg_a"), duplicate = a.clone();
  assert((await handler(a)).status === 503);
  assert((await handler(request("b.example.com", "msg_b"))).status === 200);
  assert(
    !s.rows.get("msg_a")!.delivered_at && s.rows.get("msg_b")!.delivered_at,
  );
  assert((await handler(retry("incorrect"))).status === 403);
  failing = false;
  assert((await handler(retry())).status === 200);
  assert((await handler(duplicate)).status === 200);
  assert(successful.get("msg_a") === 1 && successful.get("msg_b") === 1);
});
Deno.test("A valid signed event cannot substitute a destination through payload or query parameters", async () => {
  const s = store();
  let calls = 0;
  const handler = createResendRouter({
    secret,
    retryKey,
    store: s.value,
    routes: {
      "a.example.com": {
        company: "a",
        endpoint: "https://a.example.com/receipt",
        secret: key(),
      },
    },
    fetcher: (async (url) => {
      calls++;
      assert(String(url) === "https://a.example.com/receipt");
      return new Response("OK");
    }) as typeof fetch,
  });
  assert(
    (await handler(
      request("a.example.com", undefined, {
        endpoint: "https://attacker.example.com",
        company: "b",
      }),
    )).status === 200,
  );
  assert(calls === 1);
  assert((await handler(request("a.example.com.attacker.com"))).status === 202);
  assert(calls === 1);
});
Deno.test("Shared signing keys, unsafe endpoints, bad sender formats and non-POST methods fail closed", async () => {
  const shared = key(), s = store();
  const bad = [
    "http://a.example.com/receipt",
    "https://user:pass@a.example.com/receipt",
    "https://127.0.0.1/receipt",
    "https://a.example.com/receipt?next=evil",
    "https://a.example.com/receipt#fragment",
  ];
  for (const endpoint of bad) {
    let denied = false;
    try {
      createResendRouter({
        secret,
        retryKey,
        store: s.value,
        routes: { "a.example.com": { company: "a", endpoint, secret: shared } },
      });
    } catch {
      denied = true;
    }
    assert(denied);
  }
  let denied = false;
  try {
    createResendRouter({
      secret,
      retryKey,
      store: s.value,
      routes: {
        "a.example.com": {
          company: "a",
          endpoint: "https://a.example.com",
          secret: shared,
        },
        "b.example.com": {
          company: "b",
          endpoint: "https://b.example.com",
          secret: shared,
        },
      },
    });
  } catch {
    denied = true;
  }
  assert(denied);
  for (
    const value of [
      "a@company.example.com\nBcc: private@example.com",
      "a@company..example.com",
      "a@b@company.example.com",
      "",
      null,
    ]
  ) assert(senderDomain(value) === null);
  const handler = createResendRouter({
    secret,
    retryKey,
    store: s.value,
    routes: {},
  });
  assert(
    (await handler(new Request("https://gateway.example.com"))).status === 405,
  );
});
