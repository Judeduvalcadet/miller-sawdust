// Visibility only; office authentication and database policies still apply.
export function addressReviewAvailable(hostname, mode) {
  return hostname === 'dev.millersawdust.app' ||
    (mode === 'sandbox' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname));
}

export function needsAddressReview(customer) {
  return customer.latitude == null || customer.longitude == null ||
    !Number.isFinite(Number(customer.latitude)) || !Number.isFinite(Number(customer.longitude)) ||
    String(customer.geocode_precision || '').startsWith('REVIEW:');
}

export function customerAddress(customer) {
  return [customer.street_address, customer.city, [customer.state, customer.zip_code].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

export function reviewedAddressPatch(place, now = new Date()) {
  if (!place?.placeId || !place.street || !place.city || !place.state || !place.zip ||
      place.country !== 'US' || !Number.isFinite(place.lat) || !Number.isFinite(place.lng) ||
      place.lat < 37 || place.lat > 43.5 || place.lng < -87 || place.lng > -78) {
    throw new Error('Choose a complete Google street address in the service area, including its ZIP code.');
  }
  return {
    street_address: place.street, city: place.city, state: place.state, zip_code: place.zip,
    country: 'US', latitude: place.lat, longitude: place.lng,
    geocode_formatted_address: place.formatted, geocode_place_id: place.placeId,
    // Human confirmation is distinct from Google's automated rooftop assessment.
    geocode_precision: 'USER_VERIFIED', geocoded_at: now.toISOString(),
  };
}

export async function saveReviewedAddress(client, customer, patch) {
  let query = client.from('customers').update(patch).eq('id', customer.id);
  // Compare-and-set: don't overwrite a record changed by the office or QB
  // while this long review list was open.
  for (const field of ['updated_date', 'street_address', 'city', 'state', 'zip_code',
    'latitude', 'longitude', 'geocode_precision', 'geocode_place_id']) {
    query = customer[field] == null ? query.is(field, null) : query.eq(field, customer[field]);
  }
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This customer changed since the list loaded. Refresh the list before saving.');
  return data;
}
