// One-time upgrade path: a device holding a legacy session id (created by the
// pre-JWT client) trades it for a refresh token + JWT without re-entering a
// PIN. Works exactly once per session — the session id was only ever stored on
// the device that created it, and claiming it sets token_hash so it can't be
// replayed.
import {
  service, json, handleOptions, sha256hex, newRefreshSecret, sessionExpiry, tokenResponse,
} from '../_shared/mod.ts'

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const { session_id, device_id } = await req.json()
    if (!session_id) return json(400, { error: 'invalid_request' })

    const { data: session } = await service
      .from('driver_sessions')
      .select('id, driver_id, expires_at, token_hash')
      .eq('id', session_id)
      .maybeSingle()

    if (!session) return json(401, { error: 'invalid_session' })
    if (session.token_hash) return json(401, { error: 'already_exchanged' })
    if (new Date(session.expires_at) < new Date()) return json(401, { error: 'expired' })

    const { data: driver } = await service
      .from('drivers')
      .select('id, name, role, active')
      .eq('id', session.driver_id)
      .maybeSingle()
    if (!driver?.active) return json(401, { error: 'driver_inactive' })

    const secret = newRefreshSecret()
    await service
      .from('driver_sessions')
      .update({
        token_hash: await sha256hex(secret),
        device_id: device_id ?? undefined,
        last_used_at: new Date().toISOString(),
        expires_at: sessionExpiry(),
      })
      .eq('id', session.id)

    return json(200, await tokenResponse(driver, `${session.id}.${secret}`))
  } catch (e) {
    console.error('exchange-session error', e)
    return json(500, { error: 'server_error' })
  }
})
