// End-to-end test of the deployed auth functions against production, using a
// throwaway driver that is deleted at the end. Run from the project root.
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/auth-e2e-test.mjs
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const URL = 'https://mwunopdpquixccfdxpei.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dW5vcGRwcXVpeGNjZmR4cGVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDE4MjQsImV4cCI6MjA5MTA3NzgyNH0.xO7S5CeBN7LCE60JEmFe7v3dMw7yYxGAy5njHhdhaKA'
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE) { console.error('missing service key'); process.exit(1) }

const svc = createClient(URL, SERVICE)
const TEST_PIN = '43219'

async function fn(name, body, auth) {
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${auth || ANON}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

// setup: driver with a bcrypt credential (the post-flip steady state)
const { data: driver, error: insErr } = await svc.from('drivers').insert({
  username: 'zz_auth_test', name: 'ZZ Auth Test', role: 'driver', active: true,
}).select().single()
if (insErr) { console.error('setup failed', insErr); process.exit(1) }
await svc.from('driver_credentials').insert({
  driver_id: driver.id, pin_bcrypt: bcrypt.hashSync(TEST_PIN, 10),
})

try {
  // 1. wrong PIN rejected
  const bad = await fn('login', { driver_id: driver.id, pin: '00000', device_id: 'test' })
  check('wrong PIN rejected (401)', bad.status === 401)

  // 2. correct PIN → tokens
  const good = await fn('login', { driver_id: driver.id, pin: TEST_PIN, device_id: 'test' })
  check('correct PIN accepted (200)', good.status === 200)
  const { access_token, refresh_token } = good.data

  // 3. JWT accepted by PostgREST (signature + RLS select policy)
  const rest = await fetch(`${URL}/rest/v1/jobs?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${access_token}` },
  })
  const restRows = await rest.json().catch(() => [])
  check('JWT can read jobs', rest.status === 200 && Array.isArray(restRows) && restRows.length > 0,
    `status ${rest.status}, ${Array.isArray(restRows) ? restRows.length : 0} rows`)

  // 4. anon key alone sees NO rows (RLS enforced)
  const anonRest = await fetch(`${URL}/rest/v1/jobs?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  })
  const anonRows = await anonRest.json().catch(() => [])
  check('anon key reads zero jobs', !Array.isArray(anonRows) || anonRows.length === 0,
    `status ${anonRest.status}, ${Array.isArray(anonRows) ? anonRows.length : 'n/a'} rows`)

  // 5. anon key cannot see drivers or write jobs
  const anonDrivers = await fetch(`${URL}/rest/v1/drivers?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  }).then((r) => r.json()).catch(() => [])
  check('anon key reads zero drivers', !Array.isArray(anonDrivers) || anonDrivers.length === 0)
  const anonWrite = await fetch(`${URL}/rest/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ scheduled_date: '2030-01-01' }),
  })
  check('anon key cannot insert jobs', anonWrite.status >= 400, `status ${anonWrite.status}`)

  // 6. driver-role JWT cannot delete jobs (office-only per RLS)
  const del = await fetch(`${URL}/rest/v1/jobs?id=eq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${access_token}`, Prefer: 'return=representation' },
  })
  const delRows = await del.json().catch(() => [])
  check('driver JWT delete affects nothing', !Array.isArray(delRows) || delRows.length === 0)

  // 7. refresh works
  const ref = await fn('refresh', { refresh_token })
  check('refresh issues new token (200)', ref.status === 200 && !!ref.data.access_token)

  // 8. anon roster RPC works, exposes only id + name
  const anonClient = createClient(URL, ANON)
  const { data: roster, error: rosterErr } = await anonClient.rpc('login_roster')
  check('login_roster RPC', !rosterErr && roster.some((r) => r.id === driver.id),
    rosterErr ? rosterErr.message : `${roster?.length} names`)
  if (roster?.length) {
    const keys = Object.keys(roster[0]).sort().join(',')
    check('roster exposes only id,name', keys === 'id,name', keys)
  }

  // 9. logout revokes the session
  const out = await fn('logout', { refresh_token })
  const ref2 = await fn('refresh', { refresh_token })
  check('logout revokes session', out.status === 200 && ref2.status === 401)

  // 10. rate limit: 5 bad PINs → locked out
  for (let i = 0; i < 5; i++) await fn('login', { driver_id: driver.id, pin: '00001', device_id: 'test' })
  const locked = await fn('login', { driver_id: driver.id, pin: TEST_PIN, device_id: 'test' })
  check('lockout after 5 failures (429)', locked.status === 429, `status ${locked.status}`)
} finally {
  const { error: delErr } = await svc.from('drivers').delete().eq('id', driver.id)
  console.log(delErr ? `CLEANUP FAILED: ${delErr.message}` : 'cleanup: test driver removed (cascades sessions/credentials/attempts)')
}

process.exit(failures ? 1 : 0)
