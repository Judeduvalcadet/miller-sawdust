// Best-effort session revocation on logout.
import { service, json, handleOptions } from '../_shared/mod.ts'

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const { refresh_token, session_id } = await req.json()
    const id = refresh_token ? String(refresh_token).split('.')[0] : session_id
    if (id) await service.from('driver_sessions').delete().eq('id', id)
    return json(200, { ok: true })
  } catch (e) {
    console.error('logout error', e)
    return json(500, { error: 'server_error' })
  }
})
