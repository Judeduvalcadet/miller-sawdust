import { decodeJwt } from 'npm:jose@5.10.0';
import { verifiedState, safeCallback, redirect, oauthHeaders } from '../_shared/quickbooks-oauth.ts';

// Shared callback only. It never receives or stores access/refresh tokens and
// has no company database access. Each allowlisted company has its own state key.
if (Deno.env.get('APP_ENV') !== 'quickbooks_gateway_sandbox' || new URL(Deno.env.get('SUPABASE_URL') || '').hostname !== 'csrvvapbaicedypoonzs.supabase.co') throw new Error('Router refused a non-sandbox project.');
const routes: Record<string,{callback:string;key:string}> = JSON.parse(Deno.env.get('QB_ROUTER_ROUTES') || '{}');
Deno.serve(async req => {
  const invalid = (status:number) => new Response('Connection expired or unavailable. Start again from your company software.',{status,headers:{...oauthHeaders,'Content-Type':'text/plain; charset=utf-8'}});
  if (req.method !== 'GET') return invalid(405);
  try {
    const incoming = new URL(req.url), state = incoming.searchParams.get('state') || '';
    if (state.length > 4096) return invalid(400);
    // Decode solely to select a key, then verify before trusting any claim.
    const tenant = String(decodeJwt(state).tenant || '');
    if (!Object.hasOwn(routes,tenant)) return invalid(400);
    const route = routes[tenant];
    await verifiedState(state,route.key,tenant,'sandbox');
    const target = safeCallback(route.callback,true);
    target.search = '';
    for (const field of ['state','code','realmId','error']) {
      const values = incoming.searchParams.getAll(field);
      if (values.length > 1 || (values[0]?.length || 0) > 4096) return invalid(400);
      if (values.length) target.searchParams.set(field,values[0]);
    }
    if (!incoming.searchParams.has('code') && !incoming.searchParams.has('error')) return invalid(400);
    return redirect(target.toString());
  } catch { return invalid(400); }
});
