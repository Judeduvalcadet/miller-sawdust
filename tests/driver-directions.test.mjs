import test from 'node:test';
import assert from 'node:assert/strict';
import { directionsDestination, directionsLinks } from '../src/lib/driverDirections.js';

const job = { job_type: 'delivery', customer_id: 'customer-a', address: 'Old abbreviated address' };
const customer = { id: 'customer-a', street_address: '11041 Chestnut Ridge Rd NW', city: 'Dundee', state: 'OH', zip_code: '44624', latitude: 40.630259, longitude: -81.665004, geocode_precision: 'USER_VERIFIED' };

test('existing jobs use the corrected customer pin and current address', () => {
  const destination = directionsDestination(job, customer);
  assert.equal(destination.destination, '40.630259,-81.665004');
  assert.equal(destination.pinned, true);
  assert.match(destination.address, /Chestnut Ridge Rd NW, Dundee, OH 44624/);
  assert.equal(destination.address.includes('Old abbreviated'), false);
});

test('pickup directions use the pickup pin, never customer or drop-off pins', () => {
  const pickup = { job_type: 'pickup', pickup_location_id: 'supplier', customer_id: customer.id, dropoff_location_id: 'yard' };
  assert.equal(directionsDestination(pickup, customer), null);
  assert.equal(directionsDestination(pickup, { id: 'yard', latitude: 40, longitude: -81 }), null);
  assert.equal(directionsDestination(pickup, { id: 'supplier', address: 'Supplier location', latitude: 40.5, longitude: -81.5 }).destination, '40.5,-81.5');
});

test('questionable pins are ignored and address fallback uses the current complete address', () => {
  for (const patch of [{ latitude: null }, { latitude: '' }, { latitude: 200 }, { latitude: 0, longitude: 0 }, { geocode_precision: 'REVIEW:PARTIAL_MATCH' }]) {
    const result = directionsDestination(job, { ...customer, ...patch });
    assert.equal(result.pinned, false);
    assert.equal(result.destination, '11041 Chestnut Ridge Rd NW, Dundee, OH 44624');
  }
});

test('missing linked records do not silently use stale job addresses; legacy jobs still work', () => {
  assert.equal(directionsDestination(job, null), null);
  assert.equal(directionsDestination(job, { ...customer, id: 'someone-else' }), null);
  assert.equal(directionsDestination({ job_type: 'delivery', address: '123 Main St, Millersburg, OH 44654' }).pinned, false);
  assert.equal(directionsDestination({ address: '' }), null);
  assert.equal(directionsDestination({ address: 'PO Box 516, Sugarcreek, OH 44681' }), null);
});

test('iPhones and iPads get a direct Google Maps app link and browser fallback', () => {
  for (const [ua, touch] of [['iPhone', 0], ['iPad', 0], ['Macintosh', 5]]) {
    const links = directionsLinks(directionsDestination(job, customer), ua, touch);
    assert.equal(new URL(links.href).protocol, 'comgooglemaps:');
    assert.equal(new URL(links.href).searchParams.get('daddr'), '40.630259,-81.665004');
    assert.equal(new URL(links.href).searchParams.get('directionsmode'), 'driving');
    assert.equal(new URL(links.web).hostname, 'www.google.com');
    assert.equal(links.mobile, true);
  }
});

test('Android intent explicitly targets Google Maps with an equivalent web fallback', () => {
  const links = directionsLinks(directionsDestination(job, customer), 'Android');
  assert.ok(links.href.startsWith('intent://www.google.com/maps/dir/'));
  assert.ok(links.href.includes('package=com.google.android.apps.maps;'));
  assert.ok(links.href.includes(`S.browser_fallback_url=${encodeURIComponent(links.web)};end`));
  assert.equal(new URL(links.web).searchParams.get('destination'), '40.630259,-81.665004');
  assert.equal(new URL(links.web).searchParams.get('dir_action'), 'navigate');
});

test('desktop directions remain a correctly encoded driving link without an API key', () => {
  const text = '12 Main St #2 & North; test, OH';
  const links = directionsLinks({ destination: text }, 'Macintosh', 0);
  const url = new URL(links.href);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.searchParams.get('destination'), text);
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.has('key'), false);
  assert.equal(links.mobile, false);
  assert.equal(directionsLinks(null), null);
});
