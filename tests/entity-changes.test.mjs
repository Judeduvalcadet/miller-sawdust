import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { notifyEntityChange, subscribeEntityChanges, refreshEntityQueries, entityQueryKeys } from '../src/lib/entityChanges.js';

test('job writes invalidate V1, V2, reports, history and driver caches without touching unrelated data', async () => {
  const client = new QueryClient();
  for (const key of [...entityQueryKeys.jobs, 'settings']) client.setQueryData([key, 'scope'], []);
  await refreshEntityQueries(client, 'jobs');
  for (const key of entityQueryKeys.jobs) assert.equal(client.getQueryState([key, 'scope']).isInvalidated, true, key);
  assert.equal(client.getQueryState(['settings','scope']).isInvalidated, false);
  client.clear();
});
test('invoice changes refresh badges, customer invoices and pricing', async () => {
  const client = new QueryClient();
  for (const key of entityQueryKeys.invoices) client.setQueryData([key], []);
  await refreshEntityQueries(client, 'invoices');
  for (const key of entityQueryKeys.invoices) assert.equal(client.getQueryState([key]).isInvalidated, true, key);
  client.clear();
});
test('change subscriptions clean up and stop receiving events', () => {
  const seen = [];
  const unsubscribe = subscribeEntityChanges(table => seen.push(table));
  notifyEntityChange('jobs');
  unsubscribe();
  notifyEntityChange('customers');
  assert.deepEqual(seen, ['jobs']);
});
