// AES-256-GCM envelopes. Keys are server secrets, never stored beside ciphertext.
// AAD binds each value to its installation and column; swapping fields fails.
const utf8 = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export class QuickBooksVault {
  constructor(readonly keys: Record<string, string>, readonly active: string, readonly installation: string) {
    if (!installation || !/^[a-zA-Z0-9_-]{1,40}$/.test(active) || !keys[active]) throw new Error('QuickBooks encryption is not configured.');
  }
  private async key(id: string) {
    const raw = bytes(this.keys[id] || '');
    if (raw.length !== 32) throw new Error('QuickBooks encryption key unavailable.');
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async seal(value: string, column: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(this.installation + ':' + column) }, await this.key(this.active), utf8.encode(value));
    return ['jv1', this.active, b64(iv), b64(new Uint8Array(encrypted))].join('.');
  }
  async open(value: string, column: string): Promise<string> {
    const [version, id, iv, ciphertext, extra] = String(value).split('.');
    if (version !== 'jv1' || !id || !iv || !ciphertext || extra) throw new Error('QuickBooks connection requires secure migration.');
    try {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: utf8.encode(this.installation + ':' + column) }, await this.key(id), bytes(ciphertext)));
    } catch { throw new Error('QuickBooks connection could not be decrypted.'); }
  }
}
export function serverVault() {
  return new QuickBooksVault(JSON.parse(Deno.env.get('QB_TOKEN_KEYS') || '{}'), Deno.env.get('QB_TOKEN_KEY_ID') || '', Deno.env.get('QB_INSTALLATION_ID') || '');
}
export async function encryptedConnection<T extends Record<string, any>>(row: T): Promise<T> {
  const result = { ...row }, vault = serverVault();
  for (const name of ['access_token', 'refresh_token', 'realm_id']) if (typeof result[name] === 'string') (result as Record<string, any>)[name] = await vault.seal(result[name], name);
  return result;
}
export async function decryptedConnection<T extends Record<string, any>>(row: T): Promise<T> {
  const result = { ...row }, vault = serverVault();
  for (const name of ['access_token', 'refresh_token', 'realm_id']) if (typeof result[name] === 'string') (result as Record<string, any>)[name] = await vault.open(result[name], name);
  return result;
}
