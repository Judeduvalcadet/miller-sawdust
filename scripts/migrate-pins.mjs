// One-time migration: recover each driver's PIN from the legacy reversible
// hash and store a bcrypt hash in driver_credentials. Run BEFORE the RLS flip:
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service key> \
//   node scripts/migrate-pins.mjs
//
// Safe to re-run; drivers who already have a credential are skipped. Any
// driver whose PIN can't be recovered is listed at the end — they'll be
// lazily migrated on their next successful login (pre-flip), or can have
// their PIN reset in the Users page.
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(url, key)

const simpleHash = (str) => {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash = hash & hash
  }
  return hash.toString()
}

console.log('Building PIN lookup table (all 4-6 digit PINs)...')
const lookup = new Map()
for (let len = 4; len <= 6; len++) {
  const max = 10 ** len
  for (let n = 0; n < max; n++) {
    const pin = String(n).padStart(len, '0')
    const h = simpleHash(pin)
    if (!lookup.has(h)) lookup.set(h, pin)
  }
}

const { data: drivers, error } = await supabase.from('drivers').select('id, name, pin_hash')
if (error) throw error

const { data: existing, error: exErr } = await supabase
  .from('driver_credentials')
  .select('driver_id')
if (exErr) throw exErr
const done = new Set((existing ?? []).map((r) => r.driver_id))

let migrated = 0
let skipped = 0
const unknown = []
for (const d of drivers) {
  if (done.has(d.id)) {
    skipped++
    continue
  }
  const pin = d.pin_hash ? lookup.get(d.pin_hash) : null
  if (!pin) {
    unknown.push(d.name)
    continue
  }
  const { error: upErr } = await supabase
    .from('driver_credentials')
    .upsert({ driver_id: d.id, pin_bcrypt: bcrypt.hashSync(pin, 10) })
  if (upErr) throw upErr
  migrated++
}

console.log(`Migrated ${migrated}, already had credentials ${skipped}.`)
if (unknown.length) {
  console.log('No PIN recovered for (lazy-migrates on next login, or reset in Users page):')
  unknown.forEach((n) => console.log('  - ' + n))
}
