// Browser navigation from the shared JobYard router. No HTML or external assets.
import { service } from '../_shared/mod.ts';
import { encryptedConnection, serverVault } from '../_shared/quickbooks-vault.ts';
import { digest, verifiedState, redirect, safeCallback, oauthHeaders } from '../_shared/quickbooks-oauth.ts';
import { quickBooksRuntime } from '../_shared/quickbooks-runtime.ts';

Deno.serve(async req => {
  const fail = (status: number) => new Response('Connection request invalid or expired. Return to your software settings to reconnect.', {status,headers:{...oauthHeaders,'Content-Type':'text/plain; charset=utf-8'}});
  if (req.method !== 'GET') return fail(405);
  let runtime;
  try { runtime=quickBooksRuntime(Deno.env.toObject()); } catch { return fail(503); }
  const environment=runtime.environment;
  const url = new URL(req.url), state = url.searchParams.get('state') || '';
  let pending: any;
  try {
    const claims = await verifiedState(state, Deno.env.get('QB_OAUTH_STATE_SECRET') || '', Deno.env.get('QB_INSTALLATION_ID') || '', environment);
    const {data,error} = await service.rpc('qb_claim_oauth',{p_nonce:await digest(String(claims.nonce))});
    if (error || data?.length !== 1) return fail(400);
    pending = data[0];
  } catch { return fail(400); }
  let status = 'failed';
  try {
    if (url.searchParams.has('error')) status = 'cancelled';
    else {
      const code = url.searchParams.get('code'), realm = url.searchParams.get('realmId');
      if (!code || !realm || !/^\d{5,30}$/.test(realm)) throw new Error('Incomplete authorization.');
      if (pending.expected_realm_ciphertext && await serverVault().open(pending.expected_realm_ciphertext,'realm_id') !== realm) status = 'company_mismatch';
      else {
        const id = Deno.env.get('QB_CLIENT_ID'), secret = Deno.env.get('QB_CLIENT_SECRET'), uri = Deno.env.get('QB_REDIRECT_URI');
        if (!id || !secret || !uri) throw new Error('Missing QuickBooks credentials.');
        const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',{
          method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:`Basic ${btoa(`${id}:${secret}`)}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
          body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:uri}),
        });
        const tokens = await res.json();
        if (!res.ok || !tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in) || !Number.isFinite(tokens.x_refresh_token_expires_in)) throw new Error('Authorization rejected.');
        const info = await fetch(`${runtime.apiBase}/v3/company/${realm}/companyinfo/${realm}?minorversion=73`,{headers:{Authorization:`Bearer ${tokens.access_token}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
        const company = await info.json();
        if (!info.ok || !company.CompanyInfo?.CompanyName) throw new Error('Company identity could not be verified.');
        const {data:existing,error:readError} = await service.from('qb_tokens').select('id,realm_id').limit(1).maybeSingle();
        if (readError) throw new Error('Connection lookup failed.');
        if (existing && await serverVault().open(existing.realm_id,'realm_id') !== realm) { status='company_mismatch'; throw new Error('Company changed during authorization.'); }
        const now = new Date();
        const values = await encryptedConnection({realm_id:realm,access_token:tokens.access_token,refresh_token:tokens.refresh_token,access_token_expires_at:new Date(now.getTime()+tokens.expires_in*1000).toISOString(),refresh_token_expires_at:new Date(now.getTime()+tokens.x_refresh_token_expires_in*1000).toISOString(),company_name:company.CompanyInfo.CompanyName || null,connected_at:now.toISOString(),updated_at:now.toISOString(),...(environment==='production'?{oauth_client_id:id}:{})});
        const {error} = await (existing ? service.from('qb_tokens').update(values).eq('id',existing.id).eq('realm_id',existing.realm_id) : service.from('qb_tokens').insert(values)).select('id').single();
        if (error) throw new Error('Encrypted connection could not be saved.');
        if(environment==='production') {
          const {error:bindingError}=await service.from('qb_sync_config').upsert({id:true,realm_id:realm,enabled:true},{onConflict:'id'});
          if(bindingError)throw new Error('Company synchronization could not be enabled.');
        }
        status = 'connected';
      }
    }
  } catch { /* No codes, tokens, company data, or provider responses enter logs. */ }
  const ticket = crypto.randomUUID() + crypto.randomUUID();
  const {error} = await service.from('qb_oauth_requests').update({result_hash:await digest(ticket),result_status:status}).eq('nonce_hash',pending.nonce_hash);
  if (error) return fail(503);
  const destination = safeCallback(Deno.env.get('QB_COMPLETION_URI') || '',environment==='sandbox');
  destination.searchParams.set('ticket',ticket);
  // Browser correlation only; signed state is not an authorization credential.
  destination.searchParams.set('state',state);
  return redirect(destination.toString());
});
