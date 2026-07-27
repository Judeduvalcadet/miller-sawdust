// Shared formatting for the job activity timeline and history views.
import { format } from 'date-fns'

export const FIELD_LABELS = {
  job_type: 'Job type',
  truck_type: 'Truck type',
  scheduled_date: 'Scheduled date',
  assigned_driver_name: 'Driver',
  assigned_driver_id: 'Driver',
  assigned_driver_pickup_role: 'Pickup role',
  customer_company_name: 'Customer',
  customer_id: 'Customer',
  pickup_location_id: 'Pickup location',
  dropoff_location_id: 'Drop-off location',
  dropoff_location_name: 'Drop-off location',
  location_name: 'Location',
  address: 'Address',
  phone: 'Phone',
  quantity: 'Loads',
  pickup_yards: 'Pickup yards',
  delivery_yards: 'Delivery yards',
  yards_collected: 'Yards collected',
  load_configuration: 'Load configuration',
  loads: 'Load breakdown',
  status: 'Status',
  dispatcher_notes: 'Dispatcher notes',
  driver_notes: 'Driver notes',
  invoice_sent: 'Invoice',
  payment_collected: 'Payment collected',
  invoice_marked_by: 'Invoice marked by',
  invoice_marked_at: 'Invoice marked at',
  payment_marked_by: 'Payment marked by',
  payment_marked_at: 'Payment marked at',
  completed_at: 'Completed at',
  deleted_at: 'Removed at',
}

// Changes never worth showing (drag-sorting and internal ids create noise).
export const HIDDEN_FIELDS = new Set([
  'id', 'sort_order', 'created_date', 'updated_date',
  'customer_id', 'pickup_location_id', 'dropoff_location_id', 'assigned_driver_id',
])

// Section grouping for the "More Detail" panel, in display order.
export const SECTIONS = [
  { key: 'lifecycle', title: 'Created / Removed', fields: new Set(['__created', '__deleted']) },
  { key: 'schedule', title: 'Schedule', fields: new Set(['scheduled_date']) },
  { key: 'assignment', title: 'Driver Assignment', fields: new Set(['assigned_driver_name', 'assigned_driver_pickup_role']) },
  { key: 'delivery', title: 'Status & Delivery', fields: new Set(['status', 'completed_at', 'yards_collected', 'driver_notes']) },
  { key: 'invoicing', title: 'Invoicing & Payment', fields: new Set(['invoice_sent', 'payment_collected', 'invoice_marked_by', 'invoice_marked_at', 'payment_marked_by', 'payment_marked_at']) },
  { key: 'details', title: 'Job Details & Notes', fields: null }, // catch-all
]

export function fieldLabel(field) {
  return FIELD_LABELS[field] || field.replaceAll('_', ' ')
}

export function formatTimestamp(ts) {
  if (!ts) return '—'
  try {
    return format(new Date(ts), "EEE, MMM d yyyy 'at' h:mm a")
  } catch {
    return String(ts)
  }
}

export function formatDay(dateStr) {
  if (!dateStr) return '—'
  try {
    return format(new Date(`${dateStr}T00:00:00`), 'EEE, MMM d yyyy')
  } catch {
    return String(dateStr)
  }
}

export function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (field === 'scheduled_date') return formatDay(value)
  if (field.endsWith('_at')) return formatTimestamp(value)
  if (field === 'loads') {
    try {
      const loads = Array.isArray(value) ? value : JSON.parse(value)
      return loads.map((l) => [l.yards && `${l.yards} yd`, l.configuration || l.load_configuration].filter(Boolean).join(' ')).join(', ') || '—'
    } catch {
      return String(value)
    }
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).replaceAll('_', ' ')
}
