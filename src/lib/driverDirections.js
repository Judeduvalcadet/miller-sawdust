export function directionsDestination(job, record) {
  const pickup = job.job_type === 'pickup';
  const expectedId = pickup ? job.pickup_location_id : job.customer_id;
  // Never borrow another customer's pin, or a pickup's drop-off destination.
  const linked = record && expectedId && record.id === expectedId ? record : null;
  if (expectedId && !linked) return null;
  const address = linked
    ? pickup ? linked.address : [linked.street_address, linked.city, [linked.state, linked.zip_code].filter(Boolean).join(' '), linked.country].filter(Boolean).join(', ')
    : job.address;
  const lat = linked?.latitude;
  const lng = linked?.longitude;
  const hasPin = lat != null && lng != null && String(lat).trim() !== '' && String(lng).trim() !== '' &&
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
    Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 &&
    !(Number(lat) === 0 && Number(lng) === 0) &&
    !String(linked.geocode_precision || '').startsWith('REVIEW:');
  if (hasPin) return { destination: `${Number(lat)},${Number(lng)}`, address: address || '', pinned: true };
  // A PO box is a mailing destination, not a safe driving destination.
  if (!address?.trim() || /\b(?:P\.?\s*O\.?\s*Box|Post Office Box)\b/i.test(address)) return null;
  return { destination: address.trim(), address: address.trim(), pinned: false };
}

export function directionsLinks(destination, userAgent = '', maxTouchPoints = 0) {
  if (!destination?.destination) return null;
  const query = new URLSearchParams({ api: '1', destination: destination.destination, travelmode: 'driving', dir_action: 'navigate' });
  const web = `https://www.google.com/maps/dir/?${query}`;
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return { href: `comgooglemaps://?${new URLSearchParams({ daddr: destination.destination, directionsmode: 'driving' })}`, web, mobile: true };
  if (/Android/i.test(userAgent)) {
    return { href: `intent://www.google.com/maps/dir/?${query}#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${encodeURIComponent(web)};end`, web, mobile: true };
  }
  return { href: web, web, mobile: false };
}
