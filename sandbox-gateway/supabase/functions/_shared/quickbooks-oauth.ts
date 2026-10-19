import { jwtVerify } from 'npm:jose@5.10.0';
export const oauthHeaders = { 'Cache-Control': 'no-store, no-cache, max-age=0', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export const redirect = (url: string) => new Response(null, { status: 302, headers: { ...oauthHeaders, Location: url } });
export const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
export async function verifiedState(state: string, key: string, tenant: string, environment: string) {
  if (key.length < 32) throw new Error('State verification unavailable.');
  const { payload } = await jwtVerify(state, new TextEncoder().encode(key), { algorithms: ['HS256'], audience: 'quickbooks-oauth', issuer: 'jobyard', maxTokenAge: '10m' });
  if (payload.tenant !== tenant || payload.environment !== environment || typeof payload.nonce !== 'string') throw new Error('Invalid connection state.');
  return payload;
}
export function safeCallback(value: string, sandbox: boolean) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(sandbox && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Callback requires HTTPS.');
  return url;
}
