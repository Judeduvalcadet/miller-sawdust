// End-to-end test of the deployed auth functions against production, using a
// throwaway driver that is deleted at the end. Run from the project root.
//   SUPABASE_SERVICE_ROLE_KEY=... node auth-e2e-test.mjs
import { createClient } from '@supabase/supabase-js'

const URL = 'https://mwunopdpquixccfdxpei.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dW5vcGRwcXVpeGNjZmR4cGVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDE4MjQsImV4cCI6MjA5MTA3NzgyNH0.xO7S5CeBN7LCE60JEmFe7v3dMw7yYxGAy5njHhdhaKA'
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE) { console.error('missing service key'); process.exit(1) }

const svc = createClient(URL, SERVICE)
const TEST_PIN = '43219'

const legacyHash = (str) => {
  let h = 0
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h = h & h }
  return h.toString()
}

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

// setup: legacy-style driver (pin_hash only, no bcrypt credential)
const { data: driver, error: insErr } = await svc.from('drivers').insert({
  username: 'zz_auth_test', name: 'ZZ Auth Test', role: 'driver',
  active: true, pin_hash: legacyHash(TEST_PIN),
}).select().single()
if (insErr) { console.error('setup failed', insErr); process.exit(1) }

try {
  // 1. wrong PIN rejected
  const bad = await fn('login', { driver_id: driver.id, pin: '00000', device_id: 'test' })
  check('wrong PIN rejected (401)', bad.status === 401)

  // 2. correct PIN → tokens (exercises lazy legacy->bcrypt migration)
  const good = await fn('login', { driver_id: driver.id, pin: TEST_PIN, device_id: 'test' })
  check('correct PIN accepted (200)', good.status === 200, JSON.stringify(good.data).slice(0, 80))
  const { access_token, refresh_token } = good.data

  // 3. lazy migration minted a bcrypt credential
  const { data: cred } = await svc.from('driver_credentials').select('pin_bcrypt').eq('driver_id', driver.id).maybeSingle()
  check('bcrypt credential minted', !!cred?.pin_bcrypt?.startsWith('$2'))

  // 4. JWT accepted by PostgREST (signature matches project secret)
  const rest = await fetch(`${URL}/rest/v1/jobs?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${access_token}` },
  })
  check('JWT accepted by PostgREST', rest.status === 200, `status ${rest.status}`)

  // 5. refresh works
  const ref = await fn('refresh', { refresh_token })
  check('refresh issues new token (200)', ref.status === 200 && !!ref.data.access_token)

  // 6. anon roster RPC works and includes test driver
  const anonClient = createClient(URL, ANON)
  const { data: roster, error: rosterErr } = await anonClient.rpc('login_roster')
  check('login_roster RPC', !rosterErr && roster.some((r) => r.id === driver.id),
    rosterErr ? rosterErr.message : `${roster?.length} names`)

  // 7. roster rows expose only id + name
  if (roster?.length) {
    const keys = Object.keys(roster[0]).sort().join(',')
    check('roster exposes only id,name', keys === 'id,name', keys)
  }

  // 8. logout revokes the session
  const out = await fn('logout', { refresh_token })
  const ref2 = await fn('refresh', { refresh_token })
  check('logout revokes session', out.status === 200 && ref2.status === 401)

  // 9. rate limit: 5 bad PINs → locked out
  for (let i = 0; i < 5; i++) await fn('login', { driver_id: driver.id, pin: '00001', device_id: 'test' })
  const locked = await fn('login', { driver_id: driver.id, pin: TEST_PIN, device_id: 'test' })
  check('lockout after 5 failures (429)', locked.status === 429, `status ${locked.status}`)
} finally {
  const { error: delErr } = await svc.from('drivers').delete().eq('id', driver.id)
  console.log(delErr ? `CLEANUP FAILED: ${delErr.message}` : 'cleanup: test driver removed (cascades sessions/credentials/attempts)')
}

process.exit(failures ? 1 : 0)
