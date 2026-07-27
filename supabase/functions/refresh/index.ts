// Exchanges a refresh token for a fresh access JWT and extends the session.
import {
  service, json, handleOptions, sha256hex, sessionExpiry, tokenResponse,
} from '../_shared/mod.ts'

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const { refresh_token } = await req.json()
    const [sessionId, secret] = String(refresh_token ?? '').split('.')
    if (!sessionId || !secret) return json(400, { error: 'invalid_request' })

    const { data: session } = await service
      .from('driver_sessions')
      .select('id, driver_id, expires_at, token_hash')
      .eq('id', sessionId)
      .maybeSingle()

    if (!session?.token_hash) return json(401, { error: 'invalid_session' })
    if (new Date(session.expires_at) < new Date()) return json(401, { error: 'expired' })
    if (session.token_hash !== await sha256hex(secret)) return json(401, { error: 'invalid_session' })

    const { data: driver } = await service
      .from('drivers')
      .select('id, name, role, active')
      .eq('id', session.driver_id)
      .maybeSingle()
    if (!driver?.active) return json(401, { error: 'driver_inactive' })

    await service
      .from('driver_sessions')
      .update({ last_used_at: new Date().toISOString(), expires_at: sessionExpiry() })
      .eq('id', sessionId)

    return json(200, await tokenResponse(driver, refresh_token))
  } catch (e) {
    console.error('refresh error', e)
    return json(500, { error: 'server_error' })
  }
})
