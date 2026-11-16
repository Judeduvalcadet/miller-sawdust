// Successful local writes and remote notifications share one refresh path.
const listeners = new Set();
export function notifyEntityChange(table) {
  for (const listener of listeners) listener(table);
}
export function subscribeEntityChanges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const entityQueryKeys = {
  jobs: ['report-jobs', 'jobs', 'v1-board-jobs', 'board-week-jobs', 'board-month-dates', 'wallboard-jobs', 'v2-driver-jobs', 'driver-jobs', 'customer-jobs', 'inv-week-jobs', 'job-events', 'entity-history'],
  drivers: ['drivers'],
  customers: ['report-customers', 'customers', 'v2-customers', 'v2-address-review', 'inbox-customer-search'],
  pickup_locations: ['pickupLocations', 'pickup-locations', 'v2-pickups', 'v2-driver-pickups', 'driver-directions-destination'],
  drop_off_locations: ['dropOffLocations', 'dropoff-locations', 'v2-dropoffs', 'driver-directions-destination'],
  invoices: ['v2-invoices', 'inv-week-invoices', 'customer-invoices', 'job-invoice', 'sent-invoice-job-ids', 'customer-prices', 'prices-prefetch'],
  items: ['items', 'driver-load-items'],
  customer_item_prices: ['customer-prices', 'prices-prefetch'],
  settings: ['settings'],
  job_events: ['job-events', 'entity-history'],
};
export function refreshEntityQueries(client, table) {
  const keys = new Set(table ? entityQueryKeys[table] || [] : Object.values(entityQueryKeys).flat());
  return client.invalidateQueries({ predicate: query => keys.has(query.queryKey[0]) });
}
