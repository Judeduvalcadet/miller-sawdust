// QuickBooks Online OAuth connection management (ported from the proven
// trail-plumbing integration). Office-only: requires a PASSWORD-authenticated
// admin or secretary session - PIN sessions (and every other role) are
// refused, per the owner's access rules.
import { service, json, handleOptions } from '../_shared/mod.ts'
import { SignJWT } from 'npm:jose@5.10.0'
import { encryptedConnection, decryptedConnection, serverVault } from '../_shared/quickbooks-vault.ts'
import { digest } from '../_shared/quickbooks-oauth.ts'

import { quickBooksOffice } from '../_shared/quickbooks-access.ts'

async function logQB(action: string, status: string, message: string, details: unknown = {}) {
  try { await service.from('qb_logs').insert({ action, status, message, details }) } catch { /* never block on logging */ }
}

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const claims = await quickBooksOffice(req)
  if (!claims) return json(401, {error:'unauthorized'})

  const QB_CLIENT_ID = Deno.env.get('QB_CLIENT_ID')
  const QB_CLIENT_SECRET = Deno.env.get('QB_CLIENT_SECRET')
  const QB_REDIRECT_URI = Deno.env.get('QB_REDIRECT_URI')
  const environment = Deno.env.get('APP_ENV') === 'sandbox' ? 'sandbox' : Deno.env.get('QB_ENVIRONMENT') || 'production'
  if (!['sandbox', 'production'].includes(environment)) return json(500, { error: 'invalid_qb_environment' })
  const apiBase = environment === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com'
  if (!QB_CLIENT_ID || !QB_CLIENT_SECRET || !QB_REDIRECT_URI) {
    return json(500, { error: 'not_configured' })
  }

  try {
    const url = new URL(req.url)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const action = url.searchParams.get('action') || body.action

    // ─── Generate OAuth URL ────────────────────────────────────────────
    if (action === 'auth-url') {
      const tenant = Deno.env.get('QB_INSTALLATION_ID') || ''
      const stateKey = Deno.env.get('QB_OAUTH_STATE_SECRET') || ''
      if (!tenant || stateKey.length < 32) return json(503, {error:'secure_oauth_not_configured'})
      const nonce = crypto.randomUUID()
      const state = await new SignJWT({ nonce, environment, tenant })
        .setProtectedHeader({alg:'HS256'}).setIssuer('jobyard')
        .setAudience('quickbooks-oauth').setIssuedAt().setExpirationTime('10m')
        .sign(new TextEncoder().encode(stateKey))
      const {data:previous,error:readError} = await service.from('qb_tokens').select('realm_id').limit(1).maybeSingle()
      if (readError) throw new Error('Connection lookup failed.')
      const {data:syncConfig,error:configError} = await service.from('qb_sync_config').select('realm_id,enabled').eq('id',true).maybeSingle()
      if (configError) throw new Error('Company binding lookup failed.')
      const expectedRealm = previous?.realm_id || (syncConfig?.enabled && /^\d{5,30}$/.test(syncConfig.realm_id) ? await serverVault().seal(syncConfig.realm_id,'realm_id') : null)
      const {error} = await service.from('qb_oauth_requests').insert({nonce_hash:await digest(nonce),user_id:String(claims.sub),expected_realm_ciphertext:expectedRealm})
      if (error) throw new Error('Connection request could not be saved.')
      await service.from('qb_oauth_requests').delete().lt('expires_at',new Date(Date.now()-86400000).toISOString())
      const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2')
      authUrl.search = new URLSearchParams({client_id:QB_CLIENT_ID,response_type:'code',scope:'com.intuit.quickbooks.accounting',redirect_uri:QB_REDIRECT_URI,state}).toString()
      return json(200,{url:authUrl.toString(),state})
    }

    // Browser receives only an opaque completion ticket, never an Intuit code.
    if (action === 'callback') {
      if (typeof body.ticket !== 'string') return json(400,{error:'invalid_oauth_state'})
      const {data,error} = await service.rpc('qb_redeem_oauth',{p_result:await digest(body.ticket),p_user:String(claims.sub)})
      if (error || data?.length !== 1) return json(400,{error:'invalid_oauth_state'})
      const result = data[0]
      if (result.result_status !== 'connected') return json(400,{error:result.result_status || 'connection_failed'})
      const {data:stored} = await service.from('qb_tokens').select('*').limit(1).maybeSingle()
      if (!stored) return json(400,{error:'connection_unavailable'})
      const connection = await decryptedConnection(stored)
      return json(200,{success:true,companyName:connection.company_name,realmId:connection.realm_id})
    }

    // ─── Status (auto-refresh access token when expired) ───────────────
    if (action === 'status') {
      const { data:stored,error:readError } = await service.from('qb_tokens').select('*').limit(1).maybeSingle()
      if (readError) throw new Error('Connection lookup failed.')
      const data = stored ? await decryptedConnection(stored) : null
      if (!data) return json(200, { connected: false, environment })
      // A connection belongs to its OAuth client. Preserve the old connection
      // until the owner authorizes JobYard; never refresh it with another app.
      if (environment === 'production' && data.oauth_client_id !== QB_CLIENT_ID) return json(200, {connected:false,environment,reconnectRequired:true,companyName:data.company_name})

      const base = {
        connected: true,
        environment,
        companyName: data.company_name,
        realmId: data.realm_id,
        connectedAt: data.connected_at,
      }
      // Refresh token expired (~100 days idle) = truly disconnected
      if (data.refresh_token_expires_at && new Date(data.refresh_token_expires_at) < new Date()) {
        return json(200, { ...base, tokenExpired: true })
      }

      if (new Date(data.access_token_expires_at) < new Date() && data.refresh_token) {
        try {
          const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)
          const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
            signal: AbortSignal.timeout(12000),
            method: 'POST',
            headers: {
              Authorization: `Basic ${basicAuth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(data.refresh_token)}`,
          })
          const tokens = await res.json()
          if (res.ok && tokens.access_token) {
            const now = new Date()
            const {error:saveError} = await service.from('qb_tokens').update(await encryptedConnection({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
              refresh_token_expires_at: new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString(),
              updated_at: now.toISOString(),
            })).eq('id', data.id)
            if (saveError) throw new Error('Refreshed credentials could not be saved.')
            await logQB('token-auto-refresh', 'ok', 'Access token refreshed during status check')
          } else {
            // Surface a rejected refresh instead of silently keeping a dead token
            await logQB('token-auto-refresh', 'error',
              `Refresh rejected: ${tokens.error || `HTTP ${res.status}`}`, { error: tokens.error })
            return json(200, { ...base, tokenExpired: true })
          }
        } catch (err) {
          await logQB('token-auto-refresh', 'error', `Auto-refresh failed: ${(err as Error).message}`)
          return json(200, { ...base, tokenExpired: true })
        }
      }

      return json(200, { ...base, tokenExpired: false })
    }

    // ─── Disconnect ────────────────────────────────────────────────────
    if (action === 'disconnect') {
      const {data:stored,error:readError} = await service.from('qb_tokens').select('*').limit(1).maybeSingle()
      if (readError) throw new Error('Connection lookup failed.')
      if (stored) {
        const connection = await decryptedConnection(stored)
        const revoked = await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke',{
          method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:`Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({token:connection.refresh_token})
        })
        if (!revoked.ok) return json(503,{error:'disconnect_failed_retry'})
        const {error} = await service.from('qb_tokens').delete().eq('id',stored.id)
        if (error) throw new Error('Disconnect could not be saved.')
      }
      await logQB('oauth-disconnect', 'ok', 'QuickBooks disconnected')
      return json(200, { success: true })
    }

    return json(400, { error: 'unknown_action' })
  } catch (e) {
    console.error('qb-auth operation failed')
    return json(500, { error: 'server_error' })
  }
})
