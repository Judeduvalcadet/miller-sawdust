export const DATA_FIELDS: Record<string, string[]> = {
  messaging_conversations: ['id','channel','address','business_address','customer_id','display_name','archived','blocked','opted_out','last_message_at','last_preview','last_inbound_at','read_at','created_at'],
  messaging_messages: ['id','conversation_id','invoice_id','direction','channel','body','subject','status','provider','sent_by_name','dry_run','status_at','created_at'],
  "jobs": [
    "id",
    "job_type",
    "truck_type",
    "scheduled_date",
    "assigned_driver_id",
    "assigned_driver_name",
    "assigned_driver_pickup_role",
    "customer_id",
    "customer_company_name",
    "pickup_location_id",
    "dropoff_location_id",
    "dropoff_location_name",
    "location_name",
    "address",
    "phone",
    "quantity",
    "pickup_yards",
    "delivery_yards",
    "yards_collected",
    "load_configuration",
    "loads",
    "sort_order",
    "item_id",
    "status",
    "dispatcher_notes",
    "driver_notes",
    "invoice_sent",
    "payment_collected",
    "invoice_marked_by",
    "invoice_marked_at",
    "payment_marked_by",
    "payment_marked_at",
    "completed_at",
    "deleted_at",
    "created_date",
    "updated_date"
  ],
  "customers": [
    "id",
    "name",
    "company_name",
    "street_address",
    "city",
    "state",
    "country",
    "zip_code",
    "active",
    "billing_preference",
    "phone",
    "email",
    "map_image_url",
    "delivery_instructions",
    "created_date",
    "updated_date",
    "latitude",
    "longitude",
    "geocode_formatted_address",
    "geocode_precision",
    "geocode_place_id",
    "geocoded_at"
  ],
  "invoices": [
    "id",
    "customer_id",
    "qb_customer_id",
    "qb_id",
    "qb_sync_token",
    "doc_number",
    "txn_date",
    "due_date",
    "total",
    "balance",
    "status",
    "lines",
    "source",
    "billing_address",
    "billing_customer_id",
    "billing_mode",
    "job_id",
    "note",
    "sent_at",
    "edited_at",
    "emailed_at",
    "texted_at",
    "created_date",
    "updated_date",
    "qb_archived"
  ],
  "items": [
    "id",
    "name",
    "description",
    "unit_price",
    "item_type",
    "yards",
    "truck_type",
    "is_load_item",
    "active",
    "sort_order",
    "display_label",
    "created_date",
    "updated_date",
    "qb_id",
    "qb_sync_token",
    "qb_last_synced_at"
  ],
  "customer_item_prices": [
    "id",
    "customer_id",
    "item_id",
    "price",
    "is_default",
    "notes",
    "created_date",
    "updated_date"
  ],
  "drivers": [
    "id",
    "username",
    "name",
    "phone",
    "role",
    "driver_type",
    "pickup_role",
    "active",
    "last_login_at",
    "avatar_url",
    "created_date",
    "updated_date"
  ],
  "pickup_locations": [
    "id",
    "name",
    "phone",
    "address",
    "assigned_drivers",
    "location_type",
    "created_date",
    "updated_date",
    "latitude",
    "longitude",
    "geocode_formatted_address",
    "geocode_precision",
    "geocode_place_id",
    "geocoded_at",
    "pickup_days",
    "pickups_per_day",
    "pickup_schedule_notes"
  ],
  "drop_off_locations": [
    "id",
    "name",
    "address",
    "notes",
    "created_date",
    "updated_date",
    "latitude",
    "longitude",
    "geocode_formatted_address",
    "geocode_precision",
    "geocode_place_id",
    "geocoded_at"
  ],
  "settings": [
    "id",
    "truck_yard_presets",
    "recurring_interval_presets",
    "company_profile",
    "created_date",
    "updated_date"
  ],
  "job_events": [
    "id",
    "job_id",
    "event_type",
    "actor_name",
    "actor_role",
    "actor_id",
    "changes",
    "snapshot",
    "created_date"
  ]
}

export function validateRecordQuery(input: Record<string, unknown>) {
  const entity = String(input.entity || '')
  const allowed = DATA_FIELDS[entity]
  if (!allowed) throw new Error('Unsupported data category. Use describe_data.')
  const fields = input.fields === undefined ? allowed : input.fields
  if (!Array.isArray(fields) || !fields.length || fields.length > 40 || !fields.every(f => allowed.includes(f))) throw new Error('Unknown or restricted field.')
  const filters = input.filters ?? []
  if (!Array.isArray(filters) || filters.length > 10 || !filters.every(f => f && allowed.includes(f.field) && ['eq','contains','gte','lte','is_null'].includes(f.op) && (f.op === 'is_null' || ['string','number','boolean'].includes(typeof f.value)))) throw new Error('Invalid filters.')
  const offset = Number(input.offset ?? 0)
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid page offset.')
  const limit = Number(input.limit ?? 50)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Limit must be 1 to 50.')
  const orderBy = String(input.order_by || 'id')
  if (!allowed.includes(orderBy)) throw new Error('Invalid sort field.')
  return {entity, fields: [...new Set(['id',...fields])], filters, offset, limit, orderBy, ascending: input.descending !== true}
}

const labels: Record<string,string> = {id:'ID',doc_number:'Invoice #',job_id:'Job ID',customer_id:'Customer ID',assigned_driver_name:'Driver',location_name:'Customer / location',quantity:'Loads',loads:'Load details',lines:'Line items',txn_date:'Invoice date',billing_address:'Billing address',load_configuration:'Load configuration',sort_order:'Stop order'}
function label(field: string) { return labels[field] || field.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()) }
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((v,i)=>`${i+1}. ${formatValue(v)}`).join('\n')
  if (typeof value === 'object') return Object.entries(value).filter(([,v])=>v!==null && v!==undefined && v!=='').map(([k,v])=>`${label(k)}: ${formatValue(v)}`).join('; ')
  return typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)
}
// Original values are formatted by the server, never transcribed by the model.
export function recordTable(title: string, records: Record<string, unknown>[], fields: string[]) {
  const rows = records.map(record => fields.map(field => formatValue(record[field])))
  const additive = new Set(['quantity','pickup_yards','delivery_yards','yards_collected','total','balance'])
  if (records.length > 1 && fields.slice(1).some(f=>additive.has(f))) {
    rows.push(fields.map((field,i)=> i===0 ? 'Total' : additive.has(field) ? String(Math.round(records.reduce((sum,r)=>sum+Number(r[field] || 0),0)*100)/100) : ''))
  }
  return {title,columns:fields.map(label),rows}
}
