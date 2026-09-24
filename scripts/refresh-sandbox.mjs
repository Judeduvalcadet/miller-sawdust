// Refresh the LOCAL SANDBOX from production — one-way, read-only on prod.
// THE FREEZE (2026-09-24): production is never written by V2 work; this pull
// is the only traffic between the two. Merge-aware: sandbox-side enrichment
// (item links on jobs, customer emails) and sandbox-only tables (invoices,
// items, customer_item_prices, settings) are never clobbered.
//
//   PROD_SVC=<prod service key> LOCAL_SVC=<local secret> node scripts/refresh-sandbox.mjs
import { createClient } from '@supabase/supabase-js'

const prod = createClient('https://mwunopdpquixccfdxpei.supabase.co', process.env.PROD_SVC)
const local = createClient('http://127.0.0.1:54521', process.env.LOCAL_SVC)

async function all(db, table) {
  const rows = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from(table).select('*').range(f, f + 999)
    if (error) throw new Error(table + ': ' + error.message)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}
async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await local.from(table).upsert(rows.slice(i, i + 50), onConflict ? { onConflict } : undefined)
    if (error) throw new Error(table + ' batch ' + i + ': ' + error.message)
  }
  console.log(table.padEnd(22), rows.length, 'rows refreshed')
}

// ---- straight one-way tables (prod is the only writer) ----
for (const t of ['drivers', 'pickup_locations', 'drop_off_locations']) {
  await upsert(t, await all(prod, t))
}
await upsert('driver_credentials', await all(prod, 'driver_credentials'), 'driver_id')

// ---- customers: prod wins, but keep sandbox email/qb fields where prod has none ----
{
  const [p, l] = await Promise.all([all(prod, 'customers'), all(local, 'customers')])
  const lById = new Map(l.map((c) => [c.id, c]))
  const merged = p.map((c) => {
    const s = lById.get(c.id)
    if (!s) return c
    return {
      ...c,
      email: c.email ?? s.email,
      qb_id: c.qb_id ?? s.qb_id,
      qb_sync_token: c.qb_sync_token ?? s.qb_sync_token,
      qb_last_synced_at: c.qb_last_synced_at ?? s.qb_last_synced_at,
    }
  })
  await upsert('customers', merged)
}

// ---- jobs: prod wins, but keep sandbox item enrichment prod doesn't have ----
{
  const [p, l] = await Promise.all([all(prod, 'jobs'), all(local, 'jobs')])
  const lById = new Map(l.map((j) => [j.id, j]))
  const merged = p.map((j) => {
    const s = lById.get(j.id)
    if (!s) return j
    let loads = j.loads
    if (Array.isArray(j.loads) && Array.isArray(s.loads)) {
      const sByNum = new Map(s.loads.map((x) => [x.load_number, x]))
      loads = j.loads.map((x) => {
        const sx = sByNum.get(x.load_number)
        return (!x.item_id && sx?.item_id) ? { ...x, item_id: sx.item_id } : x
      })
    }
    return { ...j, loads, item_id: j.item_id ?? s.item_id }
  })
  await upsert('jobs', merged)
}

console.log('\nSandbox refreshed from production. Untouched by design: invoices, items,')
console.log('customer_item_prices, settings (sandbox-owned while the freeze is on).')
