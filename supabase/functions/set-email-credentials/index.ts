// Admin-only: set or update a user's email + password (office login for the
// invoicing / QuickBooks area). Requires a PASSWORD-authenticated admin
// session — a PIN session cannot grant or change office credentials. The
// very first credential is bootstrapped server-side with the service key.
import bcrypt from 'npm:bcryptjs@2'
import { service, json, handleOptions, verifyAccessToken } from '../_shared/mod.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const claims = await verifyAccessToken(req)
    const isPasswordAdmin = claims &&
      String(claims.app_role) === 'admin' && String(claims.amr) === 'password'
    if (!isPasswordAdmin) return json(403, { error: 'forbidden' })

    const { driver_id, email, password } = await req.json()
    if (!driver_id || !EMAIL_RE.test(String(email || '')) ||
        typeof password !== 'string' || password.length < 8) {
      return json(400, { error: 'invalid_request' })
    }

    const { data: user } = await service.from('drivers')
      .select('id, active').eq('id', driver_id).maybeSingle()
    if (!user?.active) return json(404, { error: 'not_found' })

    const { error } = await service.from('driver_credentials').upsert({
      driver_id,
      email: String(email).trim().toLowerCase(),
      password_bcrypt: bcrypt.hashSync(password, 10),
      password_updated_at: new Date().toISOString(),
    }, { onConflict: 'driver_id' })
    if (error) {
      if (error.message?.includes('driver_credentials_email_unique')) {
        return json(409, { error: 'email_in_use' })
      }
      throw error
    }

    return json(200, { ok: true })
  } catch (e) {
    console.error('set-email-credentials error', e)
    return json(500, { error: 'server_error' })
  }
})
