// Shared geocoding + address normalization for the Miller Sawdust edge
// functions. Mirrors the rules used by the September 2026 batch geocoding run
// so records accepted live and records accepted in the batch mean the same
// thing.

// Expansion rules for the abbreviations Google mis-reads. Conservative:
// standard forms Google already understands (US-62, OH-557, "Ely Rd") are
// left alone, as are directionals (NW/E/S).
const RULES: [RegExp, string][] = [
  [/\bC\.?\s?R\.?\s*#?\s*(\d+)/gi, 'County Road $1'],
  [/\bCo\.?\s+Rd\.?\s*#?\s*(\d+)/gi, 'County Road $1'],
  [/\bCounty\s+Rd\.?\s*#?\s*(\d+)/gi, 'County Road $1'],
  [/\bT\.?\s?R\.?\s*#?\s*(\d+)/gi, 'Township Road $1'],
  [/\bTWRD\s*#?\s*(\d+)/gi, 'Township Road $1'],
  [/\bTWP\.?\s*(?:RD\.?)?\s*#?\s*(\d+)/gi, 'Township Road $1'],
  [/\bTownship\s+Rd\.?\s*#?\s*(\d+)/gi, 'Township Road $1'],
  [/\bS\.?\s?R\.?\s*#?\s*(\d+)/gi, 'State Route $1'],
  [/\bState\s+Rt\.?e?\.?\s*#?\s*(\d+)/gi, 'State Route $1'],
]

export function normalizeAddress(addr: string): string {
  if (!addr) return addr
  let out = addr
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim().replace(/,$/, '')
}

// Service-area sanity bounds (Ohio and a generous margin).
export const BOUNDS = { latMin: 37, latMax: 43.5, lngMin: -87, lngMax: -78 }

export interface GeocodeOutcome {
  accepted: boolean
  verdict: string // location_type when accepted, REVIEW:<reason> otherwise
  lat: number | null
  lng: number | null
  formatted: string | null
  placeId: string | null
}

// Geocode one address string and classify the result with the batch rules:
// ROOFTOP / RANGE_INTERPOLATED, inside bounds, not a partial match, and no
// zip conflict -> accepted. Everything else is flagged for review.
export async function geocodeAndAssess(
  query: string,
  expectedZip: string,
  apiKey: string,
): Promise<GeocodeOutcome> {
  const review = (reason: string, extra?: Partial<GeocodeOutcome>): GeocodeOutcome => ({
    accepted: false, verdict: 'REVIEW:' + reason,
    lat: null, lng: null, formatted: null, placeId: null, ...extra,
  })

  if (!query || query.trim().length < 8) return review('MISSING_ADDRESS')

  const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(query) + '&components=country:US&key=' + apiKey

  let res: { status: string; results: Array<Record<string, unknown>> } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url).then((r) => r.json()).catch(() => null)
    if (res && res.status !== 'OVER_QUERY_LIMIT') break
    await new Promise((r) => setTimeout(r, 1200))
  }
  if (!res) return review('FETCH_FAILED')
  if (res.status === 'ZERO_RESULTS') return review('NOT_FOUND')
  if (res.status !== 'OK') return review('ERROR_' + res.status)

  const g = res.results[0] as {
    geometry: { location: { lat: number; lng: number }; location_type: string }
    formatted_address: string
    place_id: string
    partial_match?: boolean
    address_components: Array<{ types: string[]; long_name: string }>
  }
  const { lat, lng } = g.geometry.location
  const precision = g.geometry.location_type
  const googleZip = g.address_components.find((c) => c.types.includes('postal_code'))?.long_name || ''
  const withResult = { formatted: g.formatted_address, placeId: g.place_id }

  if (g.partial_match) return review('PARTIAL_MATCH', withResult)
  if (expectedZip && googleZip && expectedZip.trim() !== googleZip) {
    return review('ZIP_MISMATCH_' + googleZip, withResult)
  }
  if (!['ROOFTOP', 'RANGE_INTERPOLATED'].includes(precision)) return review(precision, withResult)
  if (lat < BOUNDS.latMin || lat > BOUNDS.latMax || lng < BOUNDS.lngMin || lng > BOUNDS.lngMax) {
    return review('OUT_OF_AREA', withResult)
  }

  return { accepted: true, verdict: precision, lat, lng, ...withResult }
}
