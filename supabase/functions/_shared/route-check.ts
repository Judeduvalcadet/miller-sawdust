// Core route-check engine, shared by the optimize-route endpoint and the
// dispatch assistant. Model (same as the 8-week study): each job is
// entry point (where the load comes from) -> exit point (customer/drop-off);
// the day starts and ends at the Home Hoop Building; only the order of jobs
// is optimized, intra-job shuttle legs are constant. Road times come from
// Google Routes (typical traffic) through the route_legs cache, so each
// origin->destination pair is fetched at most once ever.
import { service } from './mod.ts'

interface Pt { lat: number; lng: number }
interface Unit {
  job_id: string
  label: string
  job_type: string
  entry: Pt
  exit: Pt
  nLoads: number
}

const key5 = (p: Pt) => p.lat.toFixed(5) + ',' + p.lng.toFixed(5)
const odKey = (a: Pt, b: Pt) => key5(a) + '|' + key5(b)

async function fetchLeg(a: Pt, b: Pt, apiKey: string): Promise<{ seconds: number; meters: number } | null> {
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
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify(body),
    }).catch(() => null)
    if (!res) { await new Promise((r) => setTimeout(r, 1000)); continue }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue }
    const j = await res.json().catch(() => null)
    const route = j?.routes?.[0]
    if (!route) return null
    return { seconds: parseInt(route.duration), meters: route.distanceMeters ?? 0 }
  }
  return null
}

function* permutations(n: number): Generator<number[]> {
  const a = [...Array(n).keys()]
  function* go(k: number): Generator<number[]> {
    if (k === n) { yield a.slice(); return }
    for (let i = k; i < n; i++) {
      [a[k], a[i]] = [a[i], a[k]]
      yield* go(k + 1);
      [a[k], a[i]] = [a[i], a[k]]
    }
  }
  yield* go(0)
}

export type RouteCheckResult =
  | { ok: true; enough: false; jobCount: number; unpinned?: string[] }
  | {
      ok: true; enough: true; jobCount: number; unpinned: string[]
      current: { seconds: number; meters: number; order: { job_id: string; label: string; job_type: string }[] }
      suggested: { seconds: number; meters: number; order: { job_id: string; label: string; job_type: string }[] }
      savings_seconds: number
      savings_meters: number
      legs_fetched: number
    }
  | { ok: false; error: string }

export async function runRouteCheck(driver_id: string, date: string): Promise<RouteCheckResult> {
  // ---- load the day ----
  const { data: jobs, error: jobsErr } = await service.from('jobs').select('*')
    .eq('assigned_driver_id', driver_id).eq('scheduled_date', date)
    .neq('status', 'cancelled').is('deleted_at', null)
  if (jobsErr) return { ok: false, error: 'jobs_query_failed' }
  if (!jobs || jobs.length < 2) {
    return { ok: true, enough: false, jobCount: jobs?.length ?? 0 }
  }

  // Same display order the Sort Jobs modal uses = the current plan.
  jobs.sort((a, b) => {
    if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order
    if (a.sort_order != null) return -1
    if (b.sort_order != null) return 1
    return 0
  })

  // ---- resolve stop coordinates ----
  const ids = (arr: (string | null)[]) => [...new Set(arr.filter(Boolean))] as string[]
  const [custs, picks, drops] = await Promise.all([
    service.from('customers').select('id, name, company_name, latitude, longitude')
      .in('id', ids(jobs.map((j) => j.customer_id))),
    service.from('pickup_locations').select('id, name, location_type, latitude, longitude'),
    service.from('drop_off_locations').select('id, name, latitude, longitude')
      .in('id', ids(jobs.map((j) => j.dropoff_location_id))),
  ])
  const cust = new Map((custs.data ?? []).map((r) => [r.id, r]))
  const pick = new Map((picks.data ?? []).map((r) => [r.id, r]))
  const drop = new Map((drops.data ?? []).map((r) => [r.id, r]))

  const homeRow = (picks.data ?? []).find((p) =>
    p.location_type === 'my_building' && /home hoop/i.test(p.name || ''))
  if (!homeRow?.latitude) return { ok: false, error: 'home_base_not_pinned' }
  const HOME: Pt = { lat: homeRow.latitude, lng: homeRow.longitude }

  // Records on the home property that carry no pin of their own.
  const pt = (r: { name?: string; latitude?: number | null; longitude?: number | null } | undefined): Pt | null => {
    if (!r) return null
    if (/hoop building 257|own sawdust/i.test(r.name || '')) return HOME
    if (r.latitude == null) return null
    return { lat: r.latitude, lng: r.longitude! }
  }

  const units: Unit[] = []
  const unpinned: string[] = []
  for (const j of jobs) {
    const label = (j.customer_company_name || j.location_name || 'job').trim()
    let entry: Pt | null, exit: Pt | null
    if (j.job_type === 'pickup') {
      entry = pt(pick.get(j.pickup_location_id))
      exit = pt(drop.get(j.dropoff_location_id))
    } else {
      entry = j.pickup_location_id ? pt(pick.get(j.pickup_location_id)) : HOME
      exit = pt(cust.get(j.customer_id))
    }
    if (!entry || !exit) { unpinned.push(label); continue }
    const nLoads = Math.max(1, Array.isArray(j.loads) ? j.loads.length : (j.quantity || 1))
    units.push({ job_id: j.id, label, job_type: j.job_type, entry, exit, nLoads })
  }
  if (units.length < 2) {
    return { ok: true, enough: false, jobCount: jobs.length, unpinned }
  }

  // ---- leg costs: cache first, Google for the rest ----
  const needed = new Map<string, [Pt, Pt]>()
  const want = (a: Pt, b: Pt) => {
    const k = odKey(a, b)
    if (key5(a) !== key5(b) && !needed.has(k)) needed.set(k, [a, b])
  }
  for (const u of units) { want(u.entry, u.exit); if (u.nLoads > 1) want(u.exit, u.entry) }
  for (const a of units) for (const b of units) if (a !== b) want(a.exit, b.entry)
  for (const u of units) { want(HOME, u.entry); want(u.exit, HOME) }

  const legs = new Map<string, { seconds: number; meters: number }>()
  const { data: cached } = await service.from('route_legs')
    .select('od_key, seconds, meters').in('od_key', [...needed.keys()])
  for (const c of cached ?? []) legs.set(c.od_key, { seconds: c.seconds, meters: c.meters })

  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
  const missing = [...needed.entries()].filter(([k]) => !legs.has(k))
  if (missing.length && !apiKey) return { ok: false, error: 'no_api_key' }
  let cursor = 0
  const inserts: { od_key: string; seconds: number; meters: number }[] = []
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < missing.length) {
      const [k, [a, b]] = missing[cursor++]
      const leg = await fetchLeg(a, b, apiKey!)
      if (!leg) return
      legs.set(k, leg)
      inserts.push({ od_key: k, ...leg })
    }
  }))
  if (inserts.length) await service.from('route_legs').upsert(inserts)
  if ([...needed.keys()].some((k) => !legs.has(k))) {
    return { ok: false, error: 'routing_unavailable' }
  }

  // ---- cost + exact optimum ----
  const leg = (a: Pt, b: Pt) => key5(a) === key5(b)
    ? { seconds: 0, meters: 0 } : legs.get(odKey(a, b))!
  let intraS = 0, intraM = 0
  for (const u of units) {
    const f = leg(u.entry, u.exit)
    intraS += f.seconds * u.nLoads; intraM += f.meters * u.nLoads
    if (u.nLoads > 1) {
      const bk = leg(u.exit, u.entry)
      intraS += bk.seconds * (u.nLoads - 1); intraM += bk.meters * (u.nLoads - 1)
    }
  }
  const seqCost = (order: number[]) => {
    let s = 0, m = 0, prev: Pt = HOME
    for (const i of order) {
      const l = leg(prev, units[i].entry); s += l.seconds; m += l.meters
      prev = units[i].exit
    }
    const back = leg(prev, HOME)
    return { s: s + back.seconds, m: m + back.meters }
  }

  const currentOrder = [...Array(units.length).keys()]
  const current = seqCost(currentOrder)
  let best = current, bestOrder = currentOrder
  if (units.length <= 8) {
    for (const p of permutations(units.length)) {
      const c = seqCost(p)
      if (c.s < best.s) { best = c; bestOrder = p }
    }
  } else {
    // beyond 8 jobs: 2-opt refinement of the current order
    let order = [...currentOrder]
    let improved = true
    while (improved) {
      improved = false
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const trial = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)]
          if (seqCost(trial).s < seqCost(order).s) { order = trial; improved = true }
        }
      }
    }
    const c = seqCost(order)
    if (c.s < best.s) { best = c; bestOrder = order }
  }

  const describe = (order: number[]) => order.map((i) => ({
    job_id: units[i].job_id, label: units[i].label, job_type: units[i].job_type,
  }))
  return {
    ok: true, enough: true, jobCount: jobs.length,
    unpinned,
    current: { seconds: current.s + intraS, meters: current.m + intraM, order: describe(currentOrder) },
    suggested: { seconds: best.s + intraS, meters: best.m + intraM, order: describe(bestOrder) },
    savings_seconds: current.s - best.s,
    savings_meters: current.m - best.m,
    legs_fetched: inserts.length,
  }
}
