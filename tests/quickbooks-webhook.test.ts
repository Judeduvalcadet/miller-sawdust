import { quickBooksEventRows, verifyQuickBooksSignature } from '../supabase/functions/_shared/quickbooks-webhook.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
const entity = { id: '11', name: 'Customer', operation: 'Update', lastUpdated: '2026-10-16T17:00:00Z' };
Deno.test('QuickBooks verifies the original signature and rejects tampering or missing configuration', async () => {
  const body = JSON.stringify({ eventNotifications: [] });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
  assert(await verifyQuickBooksSignature(body, signature, 'test-secret'));
  assert(!await verifyQuickBooksSignature(body + ' ', signature, 'test-secret'));
  assert(!await verifyQuickBooksSignature(body, signature, ''));
  assert(!await verifyQuickBooksSignature(body, 'bad-base64!', 'test-secret'));
});
Deno.test('Batched QuickBooks notifications are isolated by company and produce stable deduplication keys', async () => {
  const payload = { eventNotifications: [
    { realmId: 'company-a', dataChangeEvent: { entities: [entity] } },
    { realmId: 'company-b', dataChangeEvent: { entities: [{ ...entity, id: '22' }] } },
  ] };
  const a = await quickBooksEventRows(payload, 'company-a');
  const again = await quickBooksEventRows(payload, 'company-a');
  const b = await quickBooksEventRows(payload, 'company-b');
  assert(a.length === 1 && a[0].entity_id === '11');
  assert(b.length === 1 && b[0].entity_id === '22');
  assert(a[0].event_key === again[0].event_key);
  assert(a[0].event_key !== b[0].event_key);
  assert((await quickBooksEventRows(payload, 'unknown')).length === 0);
});
Deno.test('Malformed matching notifications fail instead of being acknowledged and lost', async () => {
  for (const payload of [{}, { eventNotifications: [{ realmId: 'a', dataChangeEvent: { entities: [{}] } }] }]) {
    let failed = false;
    try { await quickBooksEventRows(payload, 'a'); } catch { failed = true; }
    assert(failed);
  }
});
