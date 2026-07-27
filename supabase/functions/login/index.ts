// PIN login: verifies server-side (bcrypt), rate-limits, issues JWT + refresh token.
import bcrypt from 'npm:bcryptjs@2'
import {
  service, json, handleOptions, legacyHash, createSession, tokenResponse,
} from '../_shared/mod.ts'

const MAX_FAILURES = 5
const WINDOW_MINUTES = 15

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const { driver_id, pin, device_id } = await req.json()
    if (!driver_id || typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
      return json(400, { error: 'invalid_request' })
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

    // Lockout: too many recent failures for this driver
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
    const { count } = await service
      .from('login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('driver_id', driver_id)
      .eq('success', false)
      .gte('attempted_at', windowStart)
    if ((count ?? 0) >= MAX_FAILURES) {
      return json(429, { error: 'too_many_attempts' })
    }

    const { data: driver } = await service
      .from('drivers')
      .select('id, name, role, active')
      .eq('id', driver_id)
      .maybeSingle()

    let ok = false
    if (driver?.active) {
      const { data: cred } = await service
        .from('driver_credentials')
        .select('pin_bcrypt')
        .eq('driver_id', driver_id)
        .maybeSingle()

      if (cred && bcrypt.compareSync(pin, cred.pin_bcrypt)) {
        ok = true
      } else {
        // Lazy migration + self-heal: while drivers.pin_hash still exists
        // (pre-flip), accept a legacy match and (re)mint the bcrypt credential.
        const { data: legacy } = await service
          .from('drivers')
          .select('pin_hash')
          .eq('id', driver_id)
          .maybeSingle()
        if (legacy?.pin_hash && legacy.pin_hash === legacyHash(pin)) {
          ok = true
          await service
            .from('driver_credentials')
            .upsert({ driver_id, pin_bcrypt: bcrypt.hashSync(pin, 10) })
        }
      }
    }

    await service.from('login_attempts').insert({ driver_id, ip, success: ok })
    if (!ok || !driver) return json(401, { error: 'invalid_pin' })

    const { refreshToken } = await createSession(driver.id, device_id ?? null)
    await service
      .from('drivers')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', driver.id)

    return json(200, await tokenResponse(driver, refreshToken))
  } catch (e) {
    console.error('login error', e)
    return json(500, { error: 'server_error' })
  }
})
