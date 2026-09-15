// Returns a high-res static map image of a given view so the browser can
// draw on it (canvas capture of the live map is blocked by the browser).
// The Static Maps call uses the SERVER key, which never reaches the client.
import { json, handleOptions, verifyAccessToken } from '../_shared/mod.ts'

const ROLES = ['admin', 'dispatcher', 'scheduler', 'assistant']
const TYPES = ['roadmap', 'satellite', 'hybrid']

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const claims = await verifyAccessToken(req)
    if (!claims || !ROLES.includes(String(claims.app_role))) {
      return json(403, { error: 'forbidden' })
    }

    const { lat, lng, zoom, maptype } = await req.json()
    if (typeof lat !== 'number' || typeof lng !== 'number' || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return json(400, { error: 'invalid_request' })
    }
    const z = Math.min(21, Math.max(3, Math.round(Number(zoom) || 17)))
    const type = TYPES.includes(maptype) ? maptype : 'hybrid'

    const key = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (!key) return json(500, { error: 'not_configured' })

    const url = 'https://maps.googleapis.com/maps/api/staticmap'
      + `?center=${lat},${lng}&zoom=${z}&size=640x480&scale=2&maptype=${type}&key=${key}`
    const res = await fetch(url)
    if (!res.ok) {
      console.error('staticmap error', res.status, await res.text().catch(() => ''))
      return json(502, { error: 'map_unavailable' })
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return json(200, { image: 'data:image/png;base64,' + btoa(bin), width: 1280, height: 960 })
  } catch (e) {
    console.error('map-snapshot error', e)
    return json(500, { error: 'server_error' })
  }
})
