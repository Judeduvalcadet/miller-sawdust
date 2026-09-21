// QuickBooks Online OAuth connection management (ported from the proven
// trail-plumbing integration). Office-only: requires a PASSWORD-authenticated
// admin or secretary session — PIN sessions (and every other role) are
// refused, per the owner's access rules.
import { service, json, handleOptions, verifyAccessToken } from '../_shared/mod.ts'

const OFFICE_ROLES = ['admin', 'assistant']

async function logQB(action: string, status: string, message: string, details: unknown = {}) {
  try { await service.from('qb_logs').insert({ action, status, message, details }) } catch { /* never block on logging */ }
}

async function isOffice(req: Request): Promise<boolean> {
  const claims = await verifyAccessToken(req)
  return !!claims && OFFICE_ROLES.includes(String(claims.app_role)) &&
    String(claims.amr) === 'password'
}

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  if (!(await isOffice(req))) return json(401, { error: 'unauthorized' })

  const QB_CLIENT_ID = Deno.env.get('QB_CLIENT_ID')
  const QB_CLIENT_SECRET = Deno.env.get('QB_CLIENT_SECRET')
  const QB_REDIRECT_URI = Deno.env.get('QB_REDIRECT_URI')
  if (!QB_CLIENT_ID || !QB_CLIENT_SECRET || !QB_REDIRECT_URI) {
    return json(500, { error: 'not_configured' })
  }

  try {
    const url = new URL(req.url)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const action = url.searchParams.get('action') || body.action

    // ─── Generate OAuth URL ────────────────────────────────────────────
    if (action === 'auth-url') {
      const scope = 'com.intuit.quickbooks.accounting'
      const state = crypto.randomUUID()
      const authUrl = 'https://appcenter.intuit.com/connect/oauth2' +
        `?client_id=${QB_CLIENT_ID}&response_type=code` +
        `&scope=${encodeURIComponent(scope)}` +
        `&redirect_uri=${encodeURIComponent(QB_REDIRECT_URI)}&state=${state}`
      return json(200, { url: authUrl, state })
    }

    // ─── Exchange auth code for tokens ─────────────────────────────────
    if (action === 'callback') {
      const { code, realmId } = body
      if (!code || !realmId) return json(400, { error: 'missing_code_or_realm' })

      const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)
      const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(QB_REDIRECT_URI)}`,
      })
      const tokens = await tokenRes.json()
      if (!tokenRes.ok || tokens.error || !tokens.access_token) {
        await logQB('oauth-connect', 'error', `Token exchange failed: ${tokens.error || tokenRes.status}`)
        return json(400, { error: tokens.error || `http_${tokenRes.status}`, detail: tokens.error_description })
      }

      let companyName: string | null = null
      try {
        const companyRes = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=73`,
          { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } },
        )
        companyName = (await companyRes.json()).CompanyInfo?.CompanyName ?? null
      } catch { /* name is cosmetic */ }

      const now = new Date()
      // Insert FIRST, then remove older rows: a failed insert leaves the
      // previous connection intact (delete-then-insert once left the company
      // fully disconnected in the reference app).
      const { data: inserted, error: insertErr } = await service.from('qb_tokens').insert({
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
        refresh_token_expires_at: new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString(),
        company_name: companyName,
        connected_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).select('id').single()
      if (insertErr || !inserted) {
        await logQB('oauth-connect', 'error', `Token store failed: ${insertErr?.message}`)
        return json(500, { error: 'store_failed' })
      }
      await service.from('qb_tokens').delete().neq('id', inserted.id)

      await logQB('oauth-connect', 'ok', `Connected to ${companyName} (${realmId})`, { companyName, realmId })
      return json(200, { success: true, companyName, realmId })
    }

    // ─── Status (auto-refresh access token when expired) ───────────────
    if (action === 'status') {
      const { data } = await service.from('qb_tokens').select('*').limit(1).maybeSingle()
      if (!data) return json(200, { connected: false })

      const base = {
        connected: true,
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
            await service.from('qb_tokens').update({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
              refresh_token_expires_at: new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString(),
              updated_at: now.toISOString(),
            }).eq('id', data.id)
            await logQB('token-auto-refresh', 'ok', 'Access token refreshed during status check')
          } else {
            // Surface a rejected refresh instead of silently keeping a dead token
            await logQB('token-auto-refresh', 'error',
              `Refresh rejected: ${tokens.error || `HTTP ${res.status}`}`, { error: tokens.error })
          }
        } catch (err) {
          await logQB('token-auto-refresh', 'error', `Auto-refresh failed: ${(err as Error).message}`)
        }
      }

      return json(200, { ...base, tokenExpired: false })
    }

    // ─── Disconnect ────────────────────────────────────────────────────
    if (action === 'disconnect') {
      await service.from('qb_tokens').delete().neq('realm_id', '__none__')
      await logQB('oauth-disconnect', 'ok', 'QuickBooks disconnected')
      return json(200, { success: true })
    }

    return json(400, { error: 'unknown_action' })
  } catch (e) {
    console.error('qb-auth error', e)
    return json(500, { error: 'server_error' })
  }
})
