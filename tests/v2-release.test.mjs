import test from 'node:test';
import assert from 'node:assert/strict';
import { v2ReadOnly } from '../src/lib/v2Release.js';

test('live writes require an explicit deployment opt-in', () => {
  for (const value of [undefined, '', 'false', '1', 'TRUE']) {
    assert.equal(v2ReadOnly({ MODE: 'production', VITE_V2_LIVE_WRITES: value }), true);
  }
  assert.equal(v2ReadOnly({ MODE: 'production', VITE_V2_LIVE_WRITES: 'true' }), false);
});

test('sandbox remains writable without enabling hosted deployments', () => {
  assert.equal(v2ReadOnly({ MODE: 'sandbox' }), false);
  assert.equal(v2ReadOnly({ MODE: 'development' }), true);
  assert.equal(v2ReadOnly({ MODE: 'production' }), true);
});
