import test from 'node:test';
import assert from 'node:assert/strict';
import { addressReviewAvailable, needsAddressReview, reviewedAddressPatch, saveReviewedAddress } from '../src/lib/addressReview.js';

test('review page is limited to the dev domain and local sandbox', () => {
  assert.equal(addressReviewAvailable('dev.millersawdust.app', 'production'), true);
  assert.equal(addressReviewAvailable('localhost', 'sandbox'), true);
  for (const hostname of ['millersawdust.app', 'www.millersawdust.app', 'dev.millersawdust.app.example.com', 'miller-sawdust.vercel.app']) {
    assert.equal(addressReviewAvailable(hostname, 'production'), false);
  }
  assert.equal(addressReviewAvailable('localhost', 'production'), false);
});

test('review queue retains questionable pins and removes human-confirmed addresses', () => {
  assert.equal(needsAddressReview({ latitude: null, longitude: null }), true);
  assert.equal(needsAddressReview({ latitude: 40, longitude: -81, geocode_precision: 'REVIEW:ZIP_MISMATCH' }), true);
  assert.equal(needsAddressReview({ latitude: 40, longitude: -81, geocode_precision: 'USER_VERIFIED' }), false);
});

const place = { placeId: 'test-place', street: '123 Main St', city: 'Millersburg', state: 'OH', zip: '44654', country: 'US', lat: 40.55, lng: -81.92, formatted: '123 Main St, Millersburg, OH 44654, USA' };
test('save requires a complete service-area Google selection and preserves precise coordinates', () => {
  for (const invalid of [null, {}, { ...place, placeId: '' }, { ...place, zip: '' }, { ...place, country: 'CA' }, { ...place, lat: null }, { ...place, lng: -120 }]) {
    assert.throws(() => reviewedAddressPatch(invalid));
  }
  const patch = reviewedAddressPatch(place);
  assert.equal(patch.geocode_precision, 'USER_VERIFIED');
  assert.equal(patch.latitude, place.lat);
  assert.equal(patch.geocode_place_id, place.placeId);
  assert.equal('name' in patch, false);
  assert.equal('phone' in patch, false);
});

test('concurrent edits or lost write permission cannot be reported as a successful save', async () => {
  const client = result => {
    const query = { update: () => query, eq: () => query, is: () => query, select: () => query, maybeSingle: async () => result };
    return { from: () => query };
  };
  await assert.rejects(saveReviewedAddress(client({ data: null }), { id: 'customer' }, {}), /changed since/);
  await assert.rejects(saveReviewedAddress(client({ error: new Error('permission denied') }), { id: 'customer' }, {}), /permission denied/);
  assert.deepEqual(await saveReviewedAddress(client({ data: { id: 'customer' } }), { id: 'customer' }, {}), { id: 'customer' });
});
