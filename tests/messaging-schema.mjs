// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
// Entire database is in memory; no project/customer database is contacted.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function app_role() returns text language sql as $$ select auth.jwt()->>'app_role' $$;
grant usage on schema public,auth to authenticated,service_role;
create table customers(id uuid primary key,email text,phone text);
create table invoices(id uuid primary key,sent_at timestamptz);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
`);
await db.exec(
  await readFile(
    new URL(
      "../supabase/pending-for-live/025_invoice_sending.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL("../supabase/pending-for-live/026_messaging.sql", import.meta.url),
    "utf8",
  ),
);
const invoice = "00000000-0000-4000-8000-000000000001",
  user = "00000000-0000-4000-8000-000000000002";
await db.query("insert into invoices(id) values ($1)", [invoice]);
const thread = (
  await db.query(
    `insert into messaging_conversations(channel,address,business_address) values ('sms','+13305551234','+13305550000') returning id`,
  )
).rows[0].id;
const insert = async (status = "preparing", dry = false) =>
  (
    await db.query(
      `insert into messaging_messages(conversation_id,invoice_id,direction,channel,body,status,provider,sent_by,request_id,dry_run) values ($1,$2,'outbound','sms','Invoice',$3,'twilio',$4,gen_random_uuid(),$5) returning *`,
      [thread, invoice, status, user, dry],
    )
  ).rows[0];
const simulated = await insert("preparing", true);
await db.query(`update messaging_messages set status='simulated' where id=$1`, [
  simulated.id,
]);
assert.equal(
  (await db.query("select sent_at from invoices")).rows[0].sent_at,
  null,
);
assert.equal(
  (
    await db.query(
      "select delivery_status from invoice_sends where message_id=$1",
      [simulated.id],
    )
  ).rows[0].delivery_status,
  "simulated",
);
const message = await insert();
await assert.rejects(
  db.query(
    `insert into messaging_messages(conversation_id,direction,channel,status,provider,sent_by,request_id) values ($1,'outbound','sms','preparing','twilio',$2,$3)`,
    [thread, user, message.request_id],
  ),
);
await db.query(
  `update messaging_messages set provider_id='SM_test',status='queued' where id=$1`,
  [message.id],
);
assert.ok((await db.query("select sent_at from invoices")).rows[0].sent_at);
async function event(id, status, time) {
  await db.query(
    `insert into messaging_events(provider,event_id,provider_id,status,occurred_at) values ('twilio',$1,'SM_test',$2,$3) on conflict do nothing`,
    [id, status, time],
  );
  await db.exec(`select messaging_reconcile('twilio','SM_test')`);
}
await event("delivered", "delivered", "2026-10-01T12:00:00Z");
await event("late-sent", "sent", "2026-10-01T12:01:00Z");
assert.equal(
  (
    await db.query("select status from messaging_messages where id=$1", [
      message.id,
    ])
  ).rows[0].status,
  "delivered",
);
await event("delivered", "delivered", "2026-10-01T12:00:00Z");
assert.equal(
  (await db.query("select count(*)::int as n from messaging_events")).rows[0].n,
  2,
);
// A callback that beats the provider response remains durable and is reconciled later.
await db.exec(
  `insert into messaging_events(provider,event_id,provider_id,status,occurred_at) values ('resend','early','email-id','delivered',now());select messaging_reconcile('resend','email-id');`,
);
const mail = (
  await db.query(
    `insert into messaging_messages(conversation_id,direction,channel,status,provider,provider_id) values ($1,'outbound','email','queued','resend','email-id') returning id`,
    [thread],
  )
).rows[0];
await db.exec(`select messaging_reconcile('resend','email-id')`);
assert.equal(
  (
    await db.query("select status from messaging_messages where id=$1", [
      mail.id,
    ])
  ).rows[0].status,
  "delivered",
);
// Inbound reopens archived conversations but keeps a local block intact.
await db.query("update messaging_conversations set archived=true where id=$1", [
  thread,
]);
await db.query(
  `insert into messaging_messages(conversation_id,direction,channel,status,provider,provider_id,body) values ($1,'inbound','sms','received','twilio','SM_inbound','Hello')`,
  [thread],
);
const reopened = (
  await db.query("select * from messaging_conversations where id=$1", [thread])
).rows[0];
assert.equal(reopened.archived, false);
assert.ok(reopened.last_inbound_at);
assert.equal(reopened.read_at, null);
await db.exec(
  `set role authenticated; select set_config('request.jwt.claims','{"app_role":"driver","amr":"password"}',false);`,
);
assert.equal(
  (await db.query("select count(*)::int as n from messaging_messages")).rows[0]
    .n,
  0,
);
await db.exec(
  `select set_config('request.jwt.claims','{"app_role":"admin","amr":"pin"}',false);`,
);
assert.equal(
  (await db.query("select count(*)::int as n from messaging_messages")).rows[0]
    .n,
  0,
);
await db.exec(
  `select set_config('request.jwt.claims','{"app_role":"admin","amr":"password"}',false);`,
);
assert.ok(
  (await db.query("select count(*)::int as n from messaging_messages")).rows[0]
    .n > 0,
);
await assert.rejects(
  db.exec(`update messaging_messages set status='delivered'`),
);
await assert.rejects(db.exec(`select messaging_reconcile('twilio','SM_test')`));
await db.exec("reset role");
await db.close();
console.log(
  "PASS: migration, RLS, idempotency constraints, simulation, invoice ledger, inbound unread/archive, early/duplicate/out-of-order receipts",
);
