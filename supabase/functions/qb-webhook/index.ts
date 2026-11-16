import { decryptedConnection } from '../_shared/quickbooks-vault.ts';
import { service, json } from '../_shared/mod.ts';
import { verifyQuickBooksSignature, quickBooksEventRows } from '../_shared/quickbooks-webhook.ts';

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const secret = Deno.env.get('QB_WEBHOOK_VERIFIER_TOKEN');
  if (!secret) return json(503, { error: 'webhook_not_configured' });
  const raw = await req.text();
  if (!await verifyQuickBooksSignature(raw, req.headers.get('intuit-signature') || '', secret)) {
    return json(401, { error: 'invalid_signature' });
  }
  const { data: stored, error } = await service.from('qb_tokens').select('realm_id').limit(1).maybeSingle();
  // Retry once the connection/database is ready rather than discarding changes.
  if (error || !stored) return json(503, { error: 'connection_not_ready' });
  let connection;
  try { connection=await decryptedConnection(stored); } catch { return json(503,{error:'connection_not_ready'}); }
  let rows;
  try { rows = await quickBooksEventRows(JSON.parse(raw), connection.realm_id); }
  catch { return json(400, { error: 'invalid_payload' }); }
  if (rows.length) {
    const { error: storeError } = await service.from('qb_webhook_events')
      .upsert(rows, { onConflict: 'event_key', ignoreDuplicates: true });
    if (storeError) return json(503, { error: 'event_store_failed' });
  }
  return json(200, { received: rows.length });
});
