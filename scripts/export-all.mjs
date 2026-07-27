// Full JSON export of every table, paginated past the 1000-row PostgREST cap.
// Usage: node scripts/export-all.mjs <output.json>
// Uses VITE_ vars from .env.local (or SUPABASE_URL / SUPABASE_KEY env vars).
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'

function envFromDotfile() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf-8')
    const vars = {}
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) vars[m[1]] = m[2]
    }
    return vars
  } catch {
    return {}
  }
}

const dotenv = envFromDotfile()
const url = process.env.SUPABASE_URL || dotenv.VITE_SUPABASE_URL
const key = process.env.SUPABASE_KEY || dotenv.VITE_SUPABASE_ANON_KEY
const outPath = process.argv[2]
if (!url || !key || !outPath) {
  console.error('Usage: node scripts/export-all.mjs <output.json>')
  process.exit(1)
}

const supabase = createClient(url, key)

const TABLES = [
  'jobs', 'drivers', 'customers', 'pickup_locations', 'drop_off_locations',
  'driver_sessions', 'driver_notifications', 'settings', 'log_entries',
]

const CHUNK = 1000
const backup = { exported_at: new Date().toISOString(), tables: {} }

for (const table of TABLES) {
  const rows = []
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_date', { ascending: true })
      .range(from, from + CHUNK - 1)
    if (error) {
      console.error(`FAILED on ${table}:`, error.message)
      process.exit(1)
    }
    rows.push(...(data || []))
    if (!data || data.length < CHUNK) break
  }
  backup.tables[table] = rows
  console.log(`${table}: ${rows.length} rows`)
}

writeFileSync(outPath, JSON.stringify(backup, null, 2))
console.log(`\nWrote ${outPath}`)
