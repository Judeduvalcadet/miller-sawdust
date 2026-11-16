// UI regression test against a locally running sandbox Vite server.
// All API calls are intercepted; no real customer/provider data is used.
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const thread = {
  id: "00000000-0000-4000-8000-000000000001",
  channel: "sms",
  address: "+13305551234",
  business_address: "sandbox",
  display_name: "Oak Ridge Farm",
  archived: false,
  blocked: false,
  opted_out: false,
  last_message_at: "2026-10-01T16:30:00Z",
  last_preview: "Thanks, we received the invoice.",
  last_inbound_at: "2026-10-01T16:30:00Z",
  read_at: null,
};
const messages = [
  {
    id: "m1",
    conversation_id: thread.id,
    direction: "outbound",
    channel: "sms",
    subject: "Miller Sawdust: Invoice #10482",
    body: "Miller Sawdust: Invoice #10482",
    status: "delivered",
    provider_id: "SM_fixture",
    sent_by_name: "Office",
    created_at: "2026-10-01T16:20:00Z",
    attachments: [
      {
        name: "invoice.pdf",
        path: "fixture/invoice.pdf",
        type: "application/pdf",
        size: 64320,
      },
    ],
    invoice_id: "invoice-fixture",
  },
  {
    id: "m2",
    conversation_id: thread.id,
    direction: "inbound",
    channel: "sms",
    body: "Thanks, we received the invoice.",
    status: "received",
    created_at: "2026-10-01T16:30:00Z",
    attachments: [],
  },
];
let sends = 0,
  unavailable = false;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const token =
    "test." +
    btoa(
      JSON.stringify({
        sub: "fixture-user",
        amr: "password",
        app_role: "admin",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ) +
    ".signature";
  localStorage.setItem("miller_jwt", token);
  localStorage.setItem("miller_driver_role", "admin");
  localStorage.setItem("miller_driver_name", "Test Office");
  localStorage.setItem("miller_session_id", "fixture-session");
});
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin === "http://127.0.0.1:5175") return route.continue();
  // Block all external traffic; mock only this test's intentionally invalid API endpoint.
  if (url.origin !== "http://127.0.0.1:1") return route.abort();
  let data = [];
  const request = route.request();
  if (url.pathname.includes("/functions/v1/messaging")) {
    const b = request.postDataJSON();
    if (unavailable)
      return route.fulfill({ status: 503, json: { error: "Setup pending" } });
    if (b.action === "status")
      data = {
        dry_run: true,
        writable: true,
        sms_ready: true,
        email_ready: true,
        external_sending_enabled: false,
      };
    else if (b.action === "update") {
      if (b.read_at) thread.read_at = b.read_at;
      if (typeof b.archived === "boolean") thread.archived = b.archived;
      if (typeof b.blocked === "boolean") thread.blocked = b.blocked;
      data = { ok: true };
    } else if (b.action === "send") {
      sends++;
      const message = {
        id: "m" + (messages.length + 1),
        conversation_id: thread.id,
        direction: "outbound",
        channel: "sms",
        body: b.body,
        status: "simulated",
        created_at: new Date().toISOString(),
        attachments: [],
        sent_by_name: "Test Office",
      };
      messages.push(message);
      data = { ok: true, message, dry_run: true };
    } else if (b.action === "attachment")
      data = { url: "https://example.invalid/invoice.pdf" };
  } else if (url.pathname.endsWith("/messaging_conversations")) {
    data = url.searchParams.has("id")
      ? thread
      : url.searchParams.get("archived") === `eq.${thread.archived}`
        ? [thread]
        : [];
  } else if (url.pathname.endsWith("/messaging_messages"))
    data = [...messages].reverse();
  await route.fulfill({ status: 200, json: data });
});
try {
  await page.goto("http://127.0.0.1:5175/v2/inbox");
  await page.addStyleTag({
    content: "* { scroll-behavior: auto !important; }",
  });
  await page.getByRole("button", { name: /Oak Ridge Farm/ }).click();
  await page.getByText("Delivered", { exact: false }).waitFor();
  assert.equal(await page.getByText("Miller Sawdust: Invoice #10482", { exact: true }).count(), 1);
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Thank you. Let us know when you need the next load.");
  await page
    .getByRole("button", { name: "Simulate send", exact: true })
    .click();
  await page.getByText("Simulated · not sent").waitFor();
  assert.equal(sends, 1);
  await page
    .getByRole("button", { name: "Block sending", exact: true })
    .click();
  await page.getByText("Sending is blocked for this conversation.").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Simulate send", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Unblock sending", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Block sending", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.querySelector('textarea[aria-label="Message"]').disabled,
  );
  await page.screenshot({
    path: "/tmp/miller-inbox-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({
    path: "/tmp/miller-inbox-mobile.png",
    animations: "disabled",
  });
  const sendBounds = await page
    .getByRole("button", { name: "Simulate send", exact: true })
    .boundingBox();
  assert.ok(
    sendBounds.y + sendBounds.height <= 844,
    "Mobile send button is offscreen",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Mobile horizontal overflow",
  );
  assert.ok(
    (await page.locator("section").boundingBox()).width >= 380,
    "Mobile conversation must fill the screen",
  );
  unavailable = true;
  await page.goto("http://127.0.0.1:5175/v2/inbox");
  await page.getByText(/Inbox setup is pending/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: inbox rendering, receipt labels, simulated send, block/unblock, mobile layout, setup-pending state; no live requests",
  );
} finally {
  await browser.close();
}
