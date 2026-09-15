// Route check for one driver-day. Admin + dispatcher only — suggestions,
// never writes to jobs. The engine lives in _shared/route-check.ts and is
// shared with the dispatch assistant.
import { json, handleOptions, verifyAccessToken } from '../_shared/mod.ts'
import { runRouteCheck } from '../_shared/route-check.ts'

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const claims = await verifyAccessToken(req)
    if (!claims || !['admin', 'dispatcher'].includes(String(claims.app_role))) {
      return json(403, { error: 'forbidden' })
    }

    const { driver_id, date } = await req.json()
    if (!driver_id || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return json(400, { error: 'invalid_request' })
    }

    const result = await runRouteCheck(driver_id, date)
    if (!result.ok) return json(result.error === 'routing_unavailable' ? 502 : 500, { error: result.error })
    return json(200, result)
  } catch (e) {
    console.error('optimize-route error', e)
    return json(500, { error: 'server_error' })
  }
})
