// Admin/dispatcher-only: set a user's PIN. Replaces the browser writing
// drivers.pin_hash directly.
import bcrypt from 'npm:bcryptjs@2'
import { service, json, handleOptions, verifyAccessToken, legacyHash } from '../_shared/mod.ts'

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const claims = await verifyAccessToken(req)
    if (!claims || !['admin', 'dispatcher'].includes(String(claims.app_role))) {
      return json(403, { error: 'forbidden' })
    }

    const { driver_id, pin } = await req.json()
    if (!driver_id || typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
      return json(400, { error: 'invalid_request' })
    }

    const { error } = await service
      .from('driver_credentials')
      .upsert({ driver_id, pin_bcrypt: bcrypt.hashSync(pin, 10) })
    if (error) throw error

    // Transition only: keep the legacy hash in sync so old bundles can still
    // log in until the RLS flip drops the column. Ignore failure after that.
    await service.from('drivers').update({ pin_hash: legacyHash(pin) }).eq('id', driver_id)

    return json(200, { ok: true })
  } catch (e) {
    console.error('set-pin error', e)
    return json(500, { error: 'server_error' })
  }
})
