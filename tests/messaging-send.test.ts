// Provider calls and Supabase are mocked in memory. No messages or DB writes leave the test.
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
Deno.env.set("APP_JWT_SECRET", "test-only-secret");
const { send, config, office } =
  await import("../supabase/functions/_shared/messaging.ts");
const { SignJWT } = await import("npm:jose@5");
const { service: testService } = await import("../supabase/functions/_shared/mod.ts");
// The SDK captures fetch when created; route this test client through each fixture mock.
(testService as any).rest.fetch = (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init);
const claims = {
  sub: "00000000-0000-4000-8000-000000000001",
  name: "Test Office",
  app_role: "admin",
  amr: "password",
};
function assert(value: unknown, label: string) {
  if (!value) throw new Error(label);
}
const envKeys = [
  "INVOICE_SEND_DRY_RUN",
  "MESSAGING_WRITES_ENABLED",
  "MESSAGING_SEND_ENABLED",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "RESEND_API_KEY",
  "INVOICE_FROM_EMAIL",
  "RESEND_WEBHOOK_SECRET",
  "RESEND_RELAY_WEBHOOK_SECRET",
  "MESSAGING_TEST_EMAIL_TO",
  "MESSAGING_TEST_SMS_TO",
];
function reset() {
  envKeys.forEach((k) => Deno.env.delete(k));
}
function mock(providerStatus = 201, networkFailure = false, block = false) {
  const original = globalThis.fetch;
  const tables: Record<string, any[]> = {
    settings: [{ company_profile: { company_name: "Miller Sawdust", email: "office@example.com" } }],
    drivers: [{id:claims.sub,role:'admin',active:true}],
    messaging_messages: [],
    messaging_conversations: [],
  };
  let sends = 0;
  const payloads: any[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const url = new URL(String(input)),
      method = init.method || "GET",
      headers = new Headers(init.headers);
    if (
      url.hostname === "api.twilio.com" ||
      url.hostname === "api.resend.com"
    ) {
      sends++;
      payloads.push(init.body ? (url.hostname === 'api.resend.com' ? JSON.parse(String(init.body)) : Object.fromEntries(new URLSearchParams(String(init.body)))) : null);
      if (networkFailure) throw new TypeError("Network response lost");
      return new Response(
        JSON.stringify(
          providerStatus < 300
            ? { sid: "SM_test", status: "queued", id: "email-test" }
            : { code: 21610 },
        ),
        { status: providerStatus },
      );
    }
    assert(url.port === "1", "Unexpected network request prevented");
    if (url.pathname.startsWith("/rest/v1/rpc/")) return new Response("null");
    const table = url.pathname.split("/").at(-1)!,
      rows = tables[table];
    assert(rows, `Unexpected table ${table}`);
    const match = (row: any) =>
      [...url.searchParams].every(
        ([key, value]) =>
          ["select", "order", "limit", "on_conflict"].includes(key) ||
          (value.startsWith("eq.") && String(row[key]) === value.slice(3)) ||
          (value === "is.null" && row[key] == null),
      );
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (method === "POST")
      rows.push({
        id: crypto.randomUUID(),
        blocked: block,
        opted_out: false,
        ...body,
      });
    if (method === "PATCH")
      rows.filter(match).forEach((r) => Object.assign(r, body));
    let data: any = method === "GET" ? rows.filter(match) : null;
    if (method === "GET" && headers.get("Accept")?.includes("vnd.pgrst.object"))
      data = data[0] || null;
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    tables,
    sends: () => sends,
    payloads,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
const input = () => ({
  request_id: crypto.randomUUID(),
  channel: "sms",
  to: "3305551234",
  body: "Invoice test",
});

Deno.test('Each installation sends with its own domain and profile; missing branding cannot fall back to Miller', async () => {
  for (const label of ['a','b']) {
    enable();
    Deno.env.set('RESEND_API_KEY','test-only-'+label);
    Deno.env.set('RESEND_RELAY_WEBHOOK_SECRET','relay-test-'+label);
    Deno.env.set('INVOICE_FROM_EMAIL',`Company ${label} <invoices@mail.company-${label}.example.com>`);
    const m=mock();
    try {
      m.tables.settings[0].company_profile={};
      await send({...input(),channel:'email',to:'recipient@example.com',subject:'Test'},claims);
      assert(m.payloads[0].from===`invoices@mail.company-${label}.example.com`,'Wrong sender domain');
      assert(m.payloads[0].reply_to===m.payloads[0].from,'Missing profile reused another company reply address');
      assert(!JSON.stringify(m.payloads[0]).includes('millersawdust'),'Miller branding escaped into another company');
    } finally {m.restore();reset();}
  }
});
Deno.test(
  "default server gates remain closed even when provider keys exist",
  async () => {
    reset();
    Deno.env.set("TWILIO_ACCOUNT_SID", "AC_test");
    Deno.env.set("TWILIO_AUTH_TOKEN", "token");
    Deno.env.set("TWILIO_FROM_NUMBER", "+13305550000");
    assert(!config().sms_ready, "Sender unexpectedly enabled");
    let failed = false;
    try {
      await send(input(), claims);
    } catch {
      failed = true;
    }
    assert(failed, "Disabled send must reject");
  },
);
Deno.test(
  "office gate rejects missing auth, driver role and admin PIN",
  async () => {
    for (const user of [
      null,
      { ...claims, app_role: "driver" },
      { ...claims, amr: "pin" },
    ]) {
      let token = "";
      if (user)
        token = await new SignJWT(user)
          .setProtectedHeader({ alg: "HS256" })
          .setAudience("authenticated")
          .setExpirationTime("1h")
          .sign(new TextEncoder().encode("test-only-secret"));
      let failed = false;
      try {
        await office(
          new Request("https://example.com", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
      } catch {
        failed = true;
      }
      assert(failed, "Unauthorized role accepted");
    }
  },
);
Deno.test(
  "simulation persists one record, makes no provider call, duplicate retry reuses it",
  async () => {
    reset();
    Deno.env.set("INVOICE_SEND_DRY_RUN", "true");
    const m = mock();
    try {
      const request = input(),
        first = await send(request, claims),
        second = await send(request, claims);
      assert(
        first.message.status === "simulated",
        "Simulation status incorrect",
      );
      assert(
        first.message.id === second.message.id,
        "Duplicate request created a new message",
      );
      assert(m.sends() === 0, "Simulation contacted provider");
      assert(m.tables.messaging_messages.length === 1, "Duplicate row");
    } finally {
      m.restore();
    }
  },
);
function enable() {
  reset();
  Deno.env.set("MESSAGING_WRITES_ENABLED", "true");
  Deno.env.set("MESSAGING_SEND_ENABLED", "true");
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC_test");
  Deno.env.set("TWILIO_AUTH_TOKEN", "token");
  Deno.env.set("TWILIO_FROM_NUMBER", "+13305550000");
}
Deno.test(
  "accepted message stays queued and repeated request cannot send twice",
  async () => {
    enable();
    const m = mock();
    try {
      const request = input(),
        first = await send(request, claims);
      await send(request, claims);
      assert(first.message.status === "queued", "Acceptance shown as delivery");
      assert(m.sends() === 1, "Duplicate provider send");
      assert(first.message.provider_id === "SM_test", "Missing SID");
    } finally {
      m.restore();
    }
  },
);
Deno.test(
  "uncertain response remains unknown and is never automatically resent",
  async () => {
    enable();
    const m = mock(201, true);
    try {
      const request = input(),
        first = await send(request, claims);
      await send(request, claims);
      assert(
        first.message.status === "unknown",
        "Uncertain outcome mislabeled",
      );
      assert(m.sends() === 1, "Retried uncertain provider send");
    } finally {
      m.restore();
    }
  },
);
Deno.test(
  "provider rejection and local block prevent misleading success",
  async () => {
    enable();
    let m = mock(400);
    try {
      const result = await send(input(), claims);
      assert(result.message.status === "failed", "Rejection not failed");
    } finally {
      m.restore();
    }
    m = mock(201, false, true);
    try {
      let failed = false;
      try {
        await send(input(), claims);
      } catch {
        failed = true;
      }
      assert(failed, "Blocked conversation accepted");
      assert(m.sends() === 0, "Blocked send contacted provider");
    } finally {
      m.restore();
    }
  },
);

Deno.test("restricted email testing allows only the test recipient, blocks SMS, and stays queued", async () => {
  enable();
  Deno.env.set("RESEND_API_KEY", "test-only");
  Deno.env.set("INVOICE_FROM_EMAIL", "noreply@example.com");
  Deno.env.set("MESSAGING_TEST_EMAIL_TO", "test@example.com");
  const m = mock();
  try {
    assert(config().email_ready && !config().sms_ready, "Incorrect test readiness");
    for (const request of [input(), {...input(), channel: "email", to: "other@example.com", subject: "Test"}]) {
      let rejected = false;
      try { await send(request, claims); } catch { rejected = true; }
      assert(rejected, "Unauthorized recipient accepted");
    }
    assert(m.sends() === 0 && m.tables.messaging_messages.length === 0, "Blocked request escaped guard");
    const request = {...input(), channel: "email", to: "test@example.com", subject: "Test"};
    const result = await send(request, claims);
    await send(request, claims);
    assert(result.message.status === "queued" && !result.dry_run, "Acceptance mislabeled");
    assert(m.sends() === 1, "Incorrect provider count");
  } finally { m.restore(); reset(); }
});

Deno.test('SMS test recipient can be enabled without allowing arbitrary customers',async()=>{
  enable();Deno.env.set('MESSAGING_TEST_EMAIL_TO','test@example.com');Deno.env.set('MESSAGING_TEST_SMS_TO','+13302018882');Deno.env.set('TWILIO_MESSAGING_SERVICE_SID','MG'+'0'.repeat(32));
  const m=mock();try{
    assert(config().sms_ready,'SMS test channel should be available');
    let rejected=false;try{await send({...input(),to:'+13305550123'},claims);}catch{rejected=true;}
    assert(rejected&&m.sends()===0,'Another phone number escaped the test restriction');
    const result=await send({...input(),to:'+13302018882'},claims);
    assert(result.message.status==='queued'&&m.sends()===1,'Approved SMS test was not sent');
    assert(m.payloads[0].MessagingServiceSid==='MG'+'0'.repeat(32),'SMS bypassed the installation messaging service');
  }finally{m.restore();reset();}
});

Deno.test('Messaging rechecks active office membership before allowing sends',async()=>{
  const m=mock();try{
    const token=await new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('test-only-secret'));
    const req=new Request('https://example.test',{headers:{Authorization:'Bearer '+token}});
    assert((await office(req)).sub===claims.sub,'Active office member rejected');
    for(const change of [{active:false},{active:true,role:'driver'}]){
      Object.assign(m.tables.drivers[0],change);let rejected=false;try{await office(req);}catch{rejected=true;}assert(rejected,'Stale office credential was accepted');
    }
  }finally{m.restore();}
});
