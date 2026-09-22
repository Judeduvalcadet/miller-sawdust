import { supabase } from './supabaseClient'

// ---------------------------------------------------------------------------
// Helper: parse sort field
// '-scheduled_date' → { column: 'scheduled_date', ascending: false }
// 'name'            → { column: 'name', ascending: true }
// ---------------------------------------------------------------------------
function parseSort(sortField) {
  if (!sortField) return null
  if (sortField.startsWith('-')) {
    return { column: sortField.slice(1), ascending: false }
  }
  return { column: sortField, ascending: true }
}

// ---------------------------------------------------------------------------
// Known columns per table — used to strip unknown fields before insert/update.
// Base44 SDK silently ignored unknown fields; Supabase/PostgREST rejects them.
// ---------------------------------------------------------------------------
const TABLE_COLUMNS = {
  jobs: [
    'id','job_type','truck_type','scheduled_date','assigned_driver_id','assigned_driver_name',
    'assigned_driver_pickup_role','customer_id','customer_company_name','pickup_location_id',
    'dropoff_location_id','dropoff_location_name','location_name','address','phone','quantity',
    'pickup_yards','delivery_yards','yards_collected','load_configuration','loads','sort_order','item_id',
    'status','dispatcher_notes','driver_notes','invoice_sent','payment_collected',
    'invoice_marked_by','invoice_marked_at','payment_marked_by','payment_marked_at',
    'completed_at','deleted_at','created_date','updated_date',
  ],
  drivers: [
    'id','username','name','phone','role','driver_type','pickup_role',
    'active','last_login_at','created_date','updated_date',
  ],
  customers: [
    'id','name','company_name','street_address','city','state','country','zip_code',
    'phone','email','map_image_url','delivery_instructions','created_date','updated_date',
    'latitude','longitude','geocode_formatted_address','geocode_precision','geocode_place_id','geocoded_at',
  ],
  pickup_locations: [
    'id','name','phone','address','assigned_drivers','location_type','created_date','updated_date',
    'latitude','longitude','geocode_formatted_address','geocode_precision','geocode_place_id','geocoded_at',
    'pickup_days','pickups_per_day','pickup_schedule_notes',
  ],
  drop_off_locations: [
    'id','name','address','notes','created_date','updated_date',
    'latitude','longitude','geocode_formatted_address','geocode_precision','geocode_place_id','geocoded_at',
  ],
  driver_sessions: [
    'id','driver_id','device_id','last_used_at','expires_at','created_date','updated_date',
  ],
  driver_notifications: [
    'id','driver_id','message','read','created_date','updated_date',
  ],
  settings: [
    'id','truck_yard_presets','recurring_interval_presets','company_profile','created_date','updated_date',
  ],
  // QuickBooks item catalog — qb_* columns are stamped by the server sync,
  // the rest is office-editable (name/price edits push to QBO in Phase 3).
  items: [
    'id','name','description','unit_price','item_type','yards','truck_type',
    'is_load_item','active','sort_order','display_label','created_date','updated_date',
    'qb_id','qb_sync_token','qb_last_synced_at',
  ],
  customer_item_prices: [
    'id','customer_id','item_id','price','is_default','notes','created_date','updated_date',
  ],
  // Invoice history — QuickBooks import now, app-created invoices later.
  invoices: [
    'id','customer_id','qb_customer_id','qb_id','qb_sync_token','doc_number',
    'txn_date','due_date','total','balance','status','lines','source',
    'created_date','updated_date',
  ],
  log_entries: [
    'id','timestamp','level','message','category','user_id','details','created_date','updated_date',
  ],
  // read-only: rows are written exclusively by the log_job_event() DB trigger
  job_events: [
    'id','job_id','event_type','actor_name','actor_role','actor_id','changes','snapshot','created_date',
  ],
}

// UUID foreign key columns — empty strings must become null
const UUID_COLUMNS = new Set([
  'assigned_driver_id','customer_id','pickup_location_id','dropoff_location_id','driver_id','item_id',
])

/**
 * Sanitize a record before sending to Supabase:
 * 1. Strip keys not in the table's column list
 * 2. Convert empty-string UUIDs to null
 * 3. Strip undefined values
 */
function sanitize(tableName, record) {
  const allowed = TABLE_COLUMNS[tableName]
  const clean = {}
  for (const [key, value] of Object.entries(record)) {
    // Skip unknown columns
    if (allowed && !allowed.includes(key)) continue
    // Skip undefined
    if (value === undefined) continue
    // Empty string → null for UUID FK columns
    if (UUID_COLUMNS.has(key) && value === '') {
      clean[key] = null
      continue
    }
    clean[key] = value
  }
  return clean
}

// ---------------------------------------------------------------------------
// Auto-geocoding: whenever an address is created or edited, ask the
// geocode-address edge function (server-side Google key) to refresh the
// record's coordinates. Fire-and-forget — a failed geocode never blocks or
// breaks the save; the record just keeps its REVIEW/stale state.
// ---------------------------------------------------------------------------
const GEOCODE_FIELDS = {
  customers: ['street_address', 'city', 'state', 'zip_code'],
  pickup_locations: ['address'],
  drop_off_locations: ['address'],
}

function maybeGeocode(tableName, recordId, payload) {
  const fields = GEOCODE_FIELDS[tableName]
  if (!fields || !recordId) return
  if (!fields.some(f => f in payload)) return
  // Skip when the write itself carries coordinates (imports/scripts).
  if ('latitude' in payload) return
  supabase.functions
    .invoke('geocode-address', { body: { table: tableName, id: recordId } })
    .catch(() => {})
}

// ---------------------------------------------------------------------------
// PostgREST silently caps every SELECT response at 1000 rows even when a
// larger `.limit()` is requested. To actually fetch more, we have to issue
// successive `.range(from, to)` requests in chunks of 1000 and stitch them
// together. `fetchPaginated` does that — it stops as soon as a chunk comes
// back short (end of table) or we hit the caller's requested limit.
// ---------------------------------------------------------------------------
const POSTGREST_CHUNK = 1000

async function fetchPaginated(buildQuery, limit) {
  if (limit <= POSTGREST_CHUNK) {
    const { data, error } = await buildQuery().limit(limit)
    if (error) throw error
    return data || []
  }

  const all = []
  let from = 0
  while (from < limit) {
    const to = Math.min(from + POSTGREST_CHUNK - 1, limit - 1)
    const requested = to - from + 1
    const { data, error } = await buildQuery().range(from, to)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < requested) break
    from += POSTGREST_CHUNK
  }
  return all
}

// ---------------------------------------------------------------------------
// Factory: createEntity(tableName)
// Returns an object with list, filter, create, update, delete, bulkCreate,
// and subscribe — matching the Base44 SDK interface.
// ---------------------------------------------------------------------------
function createEntity(tableName) {
  return {
    /**
     * List records with optional sort and limit.
     * @param {string}  [sortField]  e.g. 'name' or '-scheduled_date'
     * @param {number}  [limit=5000]
     * @returns {Promise<Array>}
     */
    async list(sortField, limit = 5000) {
      const sort = parseSort(sortField)
      const buildQuery = () => {
        let q = supabase.from(tableName).select('*')
        if (sort) q = q.order(sort.column, { ascending: sort.ascending })
        return q
      }
      return fetchPaginated(buildQuery, limit)
    },

    /**
     * Filter records by an object of equality conditions.
     * @param {Object}  filters    e.g. { assigned_driver_id: 'abc', active: true }
     * @param {string}  [sortField]
     * @param {number}  [limit=5000]
     * @returns {Promise<Array>}
     */
    async filter(filters, sortField, limit = 5000) {
      const sort = parseSort(sortField)
      const buildQuery = () => {
        let q = supabase.from(tableName).select('*')
        if (filters && typeof filters === 'object') {
          for (const [key, value] of Object.entries(filters)) {
            q = q.eq(key, value)
          }
        }
        if (sort) q = q.order(sort.column, { ascending: sort.ascending })
        return q
      }
      return fetchPaginated(buildQuery, limit)
    },

    /**
     * Insert a single record.
     * @param {Object} data
     * @returns {Promise<Object>} the created record
     */
    async create(data) {
      const { data: created, error } = await supabase
        .from(tableName)
        .insert(sanitize(tableName, data))
        .select()
        .single()

      if (error) throw error
      maybeGeocode(tableName, created?.id, sanitize(tableName, data))
      return created
    },

    /**
     * Update a record by id.
     * @param {string|number} id
     * @param {Object}        data
     * @returns {Promise<Object>} the updated record
     */
    async update(id, data) {
      const { data: updated, error } = await supabase
        .from(tableName)
        .update(sanitize(tableName, data))
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      maybeGeocode(tableName, id, sanitize(tableName, data))
      return updated
    },

    /**
     * Delete a record by id.
     * @param {string|number} id
     * @returns {Promise<void>}
     */
    async delete(id) {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id)

      if (error) throw error
    },

    /**
     * Insert multiple records at once.
     * @param {Array<Object>} records
     * @returns {Promise<Array>} the created records
     */
    async bulkCreate(records) {
      const { data, error } = await supabase
        .from(tableName)
        .insert(records.map(r => sanitize(tableName, r)))
        .select()

      if (error) throw error
      // Stagger the geocode calls so a big CSV import doesn't burst-fire.
      // (PostgREST returns inserted rows in input order.)
      ;(data || []).forEach((created, i) => {
        setTimeout(() => maybeGeocode(tableName, created?.id, sanitize(tableName, records[i] || {})), i * 400)
      })
      return data || []
    },

    /**
     * Subscribe to realtime changes on this table.
     * Calls `callback()` on any INSERT, UPDATE, or DELETE so the consumer
     * can refetch data (matches Base44 behaviour).
     *
     * @param {Function} callback — called with no args on every change
     * @returns {Function} unsubscribe — call to remove the subscription
     */
    subscribe(callback) {
      const channel = supabase
        .channel(`realtime:${tableName}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tableName },
          () => {
            callback()
          },
        )
        .subscribe()

      // Return an unsubscribe function
      return () => {
        supabase.removeChannel(channel)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// File upload — replaces base44.integrations.Core.UploadFile
// ---------------------------------------------------------------------------
async function uploadFile(file) {
  const fileExt = file.name.split('.').pop()
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
  const filePath = `uploads/${fileName}`

  const { error } = await supabase.storage
    .from('uploads')
    .upload(filePath, file)

  if (error) throw error

  const { data } = supabase.storage
    .from('uploads')
    .getPublicUrl(filePath)

  return { file_url: data.publicUrl }
}

// ---------------------------------------------------------------------------
// Edge Function invocation — replaces base44.functions.invoke
// ---------------------------------------------------------------------------
async function invokeFn(fnName, payload) {
  const { data, error } = await supabase.functions.invoke(fnName, {
    body: payload,
  })

  if (error) throw error
  // Return { data } wrapper to match Base44 SDK convention (callers do res.data)
  return { data }
}

// ---------------------------------------------------------------------------
// Exported base44-compatible API
// ---------------------------------------------------------------------------
export const base44 = {
  entities: {
    Job: createEntity('jobs'),
    Driver: createEntity('drivers'),
    Customer: createEntity('customers'),
    PickupLocation: createEntity('pickup_locations'),
    DropOffLocation: createEntity('drop_off_locations'),
    DriverSession: createEntity('driver_sessions'),
    DriverNotification: createEntity('driver_notifications'),
    Settings: createEntity('settings'),
    Item: createEntity('items'),
    CustomerItemPrice: createEntity('customer_item_prices'),
    Invoice: createEntity('invoices'),
    LogEntry: createEntity('log_entries'),
    JobEvent: createEntity('job_events'),
  },
  integrations: {
    Core: {
      UploadFile: async ({ file }) => uploadFile(file),
    },
  },
  functions: {
    invoke: async (fnName, payload) => invokeFn(fnName, payload),
  },
  auth: {
    // PIN-based auth — read current user from localStorage (set by DriverLogin).
    me: async () => {
      if (typeof window === 'undefined') return null
      const id = window.localStorage.getItem('miller_driver_id')
      if (!id) return null
      return {
        id,
        full_name: window.localStorage.getItem('miller_driver_name') || '',
        role: window.localStorage.getItem('miller_driver_role') || '',
      }
    },
    logout: () => {},
    redirectToLogin: () => {},
  },
}

// Also export individual pieces for direct use if needed
export { createEntity, uploadFile, invokeFn }
