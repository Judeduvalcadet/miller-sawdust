import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'

const SUPABASE_URL = 'https://mwunopdpquixccfdxpei.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dW5vcGRwcXVpeGNjZmR4cGVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDE4MjQsImV4cCI6MjA5MTA3NzgyNH0.xO7S5CeBN7LCE60JEmFe7v3dMw7yYxGAy5njHhdhaKA'

const supabase = createClient(SUPABASE_URL, ANON_KEY)

// Read the backup file
const backupPath = process.argv[2]
if (!backupPath) { console.error('Usage: node import-backup.mjs <backup.json>'); process.exit(1) }
const backup = JSON.parse(readFileSync(backupPath, 'utf-8'))

// ID mapping: old Base44 ID → new UUID
const idMap = {}

function mapId(oldId) {
  if (!oldId) return null
  if (!idMap[oldId]) idMap[oldId] = randomUUID()
  return idMap[oldId]
}

// Fields to strip from all records (Base44 metadata)
const STRIP_FIELDS = ['created_by_id', 'created_by', 'is_sample']

function stripMeta(record) {
  const clean = { ...record }
  for (const f of STRIP_FIELDS) delete clean[f]
  return clean
}

// Chunk array for batch inserts
function chunk(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

async function insertBatch(table, records) {
  let total = 0
  for (const batch of chunk(records, 50)) {
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      console.error(`  ERROR inserting into ${table}:`, error.message)
      // Try one by one to find the problematic record
      for (const rec of batch) {
        const { error: singleErr } = await supabase.from(table).insert(rec)
        if (singleErr) {
          console.error(`  SKIP record:`, singleErr.message, JSON.stringify(rec).slice(0, 200))
        } else {
          total++
        }
      }
    } else {
      total += batch.length
    }
  }
  return total
}

async function run() {
  console.log(`Importing backup from ${backup.exported_at}\n`)

  // 1. DRIVERS (no FK deps)
  const drivers = (backup.entities.Driver || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      username: r.username || '',
      name: r.name || '',
      phone: r.phone || null,
      pin_hash: r.pin_hash || null,
      role: r.role || 'driver',
      driver_type: r.driver_type || 'delivery',
      pickup_role: r.pickup_role || 'none',
      active: r.active !== false,
      last_login_at: r.last_login_at || null,
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  })
  let n = await insertBatch('drivers', drivers)
  console.log(`✓ Drivers: ${n}/${drivers.length}`)

  // 2. CUSTOMERS (no FK deps)
  const customers = (backup.entities.Customer || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      name: r.name || '',
      company_name: r.company_name || null,
      street_address: r.street_address || null,
      city: r.city || null,
      state: r.state || null,
      country: r.country || null,
      zip_code: r.zip_code || null,
      phone: r.phone || null,
      map_image_url: r.map_image_url || null,
      delivery_instructions: r.delivery_instructions || null,
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  })
  n = await insertBatch('customers', customers)
  console.log(`✓ Customers: ${n}/${customers.length}`)

  // 3. PICKUP LOCATIONS (no FK deps)
  const pickupLocations = (backup.entities.PickupLocation || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      name: r.name || '',
      phone: r.phone || null,
      address: r.address || '',
      assigned_drivers: Array.isArray(r.assigned_drivers) ? r.assigned_drivers : [],
      location_type: r.location_type || 'supplier',
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  })
  n = await insertBatch('pickup_locations', pickupLocations)
  console.log(`✓ Pickup Locations: ${n}/${pickupLocations.length}`)

  // 4. DROP-OFF LOCATIONS (no FK deps)
  const dropOffLocations = (backup.entities.DropOffLocation || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      name: r.name || '',
      address: r.address || null,
      notes: r.notes || null,
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  })
  n = await insertBatch('drop_off_locations', dropOffLocations)
  console.log(`✓ Drop-Off Locations: ${n}/${dropOffLocations.length}`)

  // 5. JOBS (FK: drivers, customers, pickup_locations, drop_off_locations)
  const jobs = (backup.entities.Job || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      job_type: r.job_type || 'delivery',
      truck_type: r.truck_type || 'straight_truck',
      scheduled_date: r.scheduled_date,
      assigned_driver_id: r.assigned_driver_id ? mapId(r.assigned_driver_id) : null,
      assigned_driver_name: r.assigned_driver_name || null,
      assigned_driver_pickup_role: r.assigned_driver_pickup_role || null,
      customer_id: r.customer_id ? mapId(r.customer_id) : null,
      customer_company_name: r.customer_company_name || null,
      pickup_location_id: r.pickup_location_id ? mapId(r.pickup_location_id) : null,
      dropoff_location_id: r.dropoff_location_id ? mapId(r.dropoff_location_id) : null,
      dropoff_location_name: r.dropoff_location_name || null,
      location_name: r.location_name || null,
      address: r.address || null,
      phone: r.phone || null,
      quantity: r.quantity || 1,
      pickup_yards: r.pickup_yards || null,
      delivery_yards: r.delivery_yards || null,
      yards_collected: r.yards_collected || r.yards_picked_up || null,
      load_configuration: r.load_configuration || null,
      loads: r.loads || null,
      sort_order: r.sort_order != null ? r.sort_order : null,
      status: r.status || 'pending',
      dispatcher_notes: r.dispatcher_notes || null,
      driver_notes: r.driver_notes || null,
      invoice_sent: r.invoice_sent || null,
      payment_collected: r.payment_collected || false,
      invoice_marked_by: r.invoice_marked_by || null,
      invoice_marked_at: r.invoice_marked_at || null,
      payment_marked_by: r.payment_marked_by || null,
      payment_marked_at: r.payment_marked_at || null,
      completed_at: r.completed_at || null,
      deleted_at: r.deleted_at || null,
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  })
  n = await insertBatch('jobs', jobs)
  console.log(`✓ Jobs: ${n}/${jobs.length}`)

  // 6. DRIVER SESSIONS (FK: drivers)
  const sessions = (backup.entities.DriverSession || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      driver_id: r.driver_id ? mapId(r.driver_id) : null,
      device_id: r.device_id || null,
      last_used_at: r.last_used_at || null,
      expires_at: r.expires_at || null,
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  }).filter(r => r.driver_id) // skip sessions with no driver
  n = await insertBatch('driver_sessions', sessions)
  console.log(`✓ Driver Sessions: ${n}/${sessions.length}`)

  // 7. DRIVER NOTIFICATIONS (FK: drivers)
  const notifications = (backup.entities.DriverNotification || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      driver_id: r.driver_id ? mapId(r.driver_id) : null,
      message: r.message || '',
      read: r.read || false,
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  }).filter(r => r.driver_id)
  n = await insertBatch('driver_notifications', notifications)
  console.log(`✓ Driver Notifications: ${n}/${notifications.length}`)

  // 8. SETTINGS
  const settings = (backup.entities.Settings || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      truck_yard_presets: r.truck_yard_presets || null,
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  })
  n = await insertBatch('settings', settings)
  console.log(`✓ Settings: ${n}/${settings.length}`)

  // 9. LOG ENTRIES (skip — 5000 records of old logs, not critical)
  const logEntries = (backup.entities.LogEntry || []).map(r => {
    r = stripMeta(r)
    return {
      id: mapId(r.id),
      timestamp: r.timestamp || r.created_date || new Date().toISOString(),
      level: ['info','warn','error','debug'].includes(r.level) ? r.level : 'info',
      message: (r.message || '').slice(0, 2000),
      category: ['frontend','backend','database','integration'].includes(r.category) ? r.category : 'frontend',
      user_id: r.userId || r.user_id || null,
      details: r.details || null,
      created_date: r.created_date || new Date().toISOString(),
      updated_date: r.updated_date || new Date().toISOString(),
    }
  })
  n = await insertBatch('log_entries', logEntries)
  console.log(`✓ Log Entries: ${n}/${logEntries.length}`)

  console.log('\n✅ Import complete!')
}

run().catch(err => { console.error('Fatal:', err); process.exit(1) })
