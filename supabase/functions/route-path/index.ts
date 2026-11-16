// Returns the actual road geometry (Google encoded polylines) for a chain of
// stops, one leg per consecutive pair. Admin + dispatcher only. Legs are
// served from the route_legs cache; missing geometry is fetched once from the
// Routes API (server key) and cached forever alongside the leg's time/distance.
import { service, json, handleOptions, verifyAccessToken } from '../_shared/mod.ts'

interface Pt { lat: number; lng: number }
const key5 = (p: Pt) => p.lat.toFixed(5) + ',' + p.lng.toFixed(5)
const odKey = (a: Pt, b: Pt) => key5(a) + '|' + key5(b)

async function fetchLeg(a: Pt, b: Pt, apiKey: string) {
  const body = {
    origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
    destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
    travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE',
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
    }).catch(() => null)
    if (!res) { await new Promise((r) => setTimeout(r, 1000)); continue }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue }
    const j = await res.json().catch(() => null)
    const route = j?.routes?.[0]
    if (!route) return null
    return {
      seconds: parseInt(route.duration),
      meters: route.distanceMeters ?? 0,
      polyline: route.polyline?.encodedPolyline ?? null,
    }
  }
  return null
}

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const claims = await verifyAccessToken(req)
    if (!claims || !['admin', 'dispatcher'].includes(String(claims.app_role))) {
      return json(403, { error: 'forbidden' })
    }

    const { points } = await req.json()
    if (!Array.isArray(points) || points.length < 2 || points.length > 16 ||
        points.some((p) => typeof p?.lat !== 'number' || typeof p?.lng !== 'number' ||
          p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180)) {
      return json(400, { error: 'invalid_request' })
    }

    // Consecutive pairs; identical points (aliased stops) produce no leg.
    const pairs: Array<{ key: string; a: Pt; b: Pt } | null> = []
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1]
      pairs.push(key5(a) === key5(b) ? null : { key: odKey(a, b), a, b })
    }

    const keys = [...new Set(pairs.filter(Boolean).map((p) => p!.key))]
    const { data: cached } = await service.from('route_legs')
      .select('od_key, polyline').in('od_key', keys)
    const byKey = new Map((cached ?? []).map((r) => [r.od_key, r.polyline]))

    const missing = keys.filter((k) => !byKey.get(k))
    if (missing.length) {
      const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
      if (!apiKey) return json(500, { error: 'not_configured' })
      const byMissing = new Map(pairs.filter(Boolean).map((p) => [p!.key, p!]))
      let cursor = 0
      const upserts: Array<{ od_key: string; seconds: number; meters: number; polyline: string | null }> = []
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (cursor < missing.length) {
          const k = missing[cursor++]
          const pair = byMissing.get(k)!
          const leg = await fetchLeg(pair.a, pair.b, apiKey)
          if (!leg) continue
          byKey.set(k, leg.polyline)
          upserts.push({ od_key: k, ...leg })
        }
      }))
      if (upserts.length) await service.from('route_legs').upsert(upserts)
    }

    return json(200, { legs: pairs.map((p) => (p ? byKey.get(p.key) ?? null : null)) })
  } catch (e) {
    console.error('route-path error', e)
    return json(500, { error: 'server_error' })
  }
})
