export async function verifyQuickBooksSignature(body: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !signature) return false;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const bytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(body));
  } catch { return false; }
}

export async function quickBooksEventRows(payload: unknown, realm: string) {
  const notifications = (payload as { eventNotifications?: unknown[] })?.eventNotifications;
  if (!Array.isArray(notifications)) throw new Error('Invalid QuickBooks payload');
  const rows = [];
  for (const notification of notifications) {
    const entry = notification as { realmId?: string; dataChangeEvent?: { entities?: unknown[] } };
    if (String(entry.realmId) !== realm) continue;
    const entities = entry.dataChangeEvent?.entities;
    if (!Array.isArray(entities)) throw new Error('Missing change entities');
    for (const value of entities) {
      const entity = value as { id?: string; name?: string; operation?: string; lastUpdated?: string };
      if (!entity.id || !entity.name || !entity.operation || !entity.lastUpdated) throw new Error('Incomplete change entity');
      const identity = JSON.stringify([realm, entity.name, entity.id, entity.operation, entity.lastUpdated]);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
      rows.push({
        event_key: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''),
        realm_id: realm, entity_name: entity.name, entity_id: String(entity.id),
        operation: entity.operation, source_updated_at: entity.lastUpdated, payload: entity,
      });
    }
  }
  return rows;
}
