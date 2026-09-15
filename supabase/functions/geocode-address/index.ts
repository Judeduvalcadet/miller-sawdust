// Geocode one record on save. Called fire-and-forget by the app after a
// customer / pickup / drop-off address is created or edited, and by the CSV
// re-import. The Google key lives only in function secrets — never in the
// browser. Accepted results write coordinates (and the normalized street
// text); everything else clears the pin and marks REVIEW:<reason> so the
// record shows up as needing attention instead of silently keeping a stale pin.
import { service, json, handleOptions, verifyAccessToken } from '../_shared/mod.ts'
import { normalizeAddress, geocodeAndAssess } from '../_shared/geo.ts'

const WRITE_ROLES = ['admin', 'dispatcher', 'scheduler', 'assistant']

const TABLES: Record<string, { street: string }> = {
  customers: { street: 'street_address' },
  pickup_locations: { street: 'address' },
  drop_off_locations: { street: 'address' },
}

Deno.serve(async (req) => {
  const opts = handleOptions(req)
  if (opts) return opts

  try {
    const claims = await verifyAccessToken(req)
    if (!claims || !WRITE_ROLES.includes(String(claims.app_role))) {
      return json(403, { error: 'forbidden' })
    }

    const { table, id } = await req.json()
    const spec = TABLES[table]
    if (!spec || !id) return json(400, { error: 'invalid_request' })

    const { data: row, error } = await service.from(table).select('*').eq('id', id).single()
    if (error || !row) return json(404, { error: 'not_found' })

    const street = normalizeAddress(row[spec.street] || '')
    const query = table === 'customers'
      ? [street, row.city, (row.state || 'OH') + (row.zip_code ? ' ' + row.zip_code : '')]
          .filter(Boolean).join(', ')
      : street
    const zip = table === 'customers' ? (row.zip_code || '') : ''

    const key = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (!key) return json(500, { error: 'no_api_key' })
    const out = await geocodeAndAssess(query, zip, key)

    const update: Record<string, unknown> = {
      latitude: out.lat,
      longitude: out.lng,
      geocode_formatted_address: out.formatted,
      geocode_precision: out.verdict,
      geocode_place_id: out.placeId,
      geocoded_at: new Date().toISOString(),
    }
    // Keep the address text in its readable expanded form once verified,
    // same as the batch run did.
    if (out.accepted && street && street !== row[spec.street]) update[spec.street] = street

    const { error: upErr } = await service.from(table).update(update).eq('id', id)
    if (upErr) throw upErr

    return json(200, { ok: true, accepted: out.accepted, verdict: out.verdict })
  } catch (e) {
    console.error('geocode-address error', e)
    return json(500, { error: 'server_error' })
  }
})
