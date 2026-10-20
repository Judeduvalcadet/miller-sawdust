// Read-only integration checks against the isolated local database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { fetchInvoicePage, fetchSelectedInvoices } from '../src/lib/invoiceList.js';

const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
if (status.status) throw new Error('Local Supabase is required.');
const config = JSON.parse(status.stdout);
if (config.API_URL !== 'http://127.0.0.1:54521') throw new Error('Refusing to test a hosted database.');
const client = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const all = [];
for (let start = 0; ; start += 1000) {
  const { data, error } = await client.from('invoices').select('*,customer:customers(*)').order('id').range(start, start + 999);
  if (error) throw error;
  all.push(...data);
  if (data.length < 1000) break;
}
const expected = (options = {}) => all.filter(inv => {
  if (inv.qb_archived) return false;
  if (options.status && options.status !== 'all' && inv.status !== options.status) return false;
  if (options.from && (!inv.txn_date || inv.txn_date < options.from)) return false;
  if (options.to && (!inv.txn_date || inv.txn_date > options.to)) return false;
  const term = (options.search || '').trim().toLowerCase();
  return !term || [inv.customer?.company_name, inv.customer?.name, inv.doc_number, inv.note].filter(value => value != null).join(' ').toLowerCase().includes(term);
}).sort((a, b) => (b.txn_date || '').localeCompare(a.txn_date || '') || b.id.localeCompare(a.id));

test('page boundaries, exact totals and customer details match the full reference dataset', async () => {
  const reference = expected();
  assert.ok(reference.length > 100, 'Use the seeded local invoice history.');
  for (const pageSize of [25, 50, 100]) {
    const first = await fetchInvoicePage(client, { page: 1, pageSize });
    const second = await fetchInvoicePage(client, { page: 2, pageSize });
    assert.equal(first.total, reference.length);
    assert.equal(first.rows.length, pageSize);
    assert.deepEqual(first.rows.map(row => row.id), reference.slice(0, pageSize).map(row => row.id));
    assert.deepEqual(second.rows.map(row => row.id), reference.slice(pageSize, pageSize * 2).map(row => row.id));
    assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, pageSize * 2);
    for (const row of first.rows) assert.deepEqual(row.customer, reference.find(inv => inv.id === row.id).customer);
  }
});

test('search finds records outside the first page and treats punctuation literally', async () => {
  const reference = expected();
  for (const search of [reference.at(-1).doc_number, reference.find(inv => inv.customer?.name)?.customer.name, '"),status.eq.paid', '%_', 'no-such-invoice-7f9a']) {
    const result = await fetchInvoicePage(client, { search, pageSize: 25 });
    const matching = expected({ search });
    assert.equal(result.total, matching.length);
    assert.deepEqual(result.rows.map(row => row.id), matching.slice(0, 25).map(row => row.id));
  }
});

test('paid, unpaid and inclusive date filtering happen before pagination', async () => {
  const date = expected().find(inv => inv.txn_date)?.txn_date;
  for (const options of [{ status: 'paid' }, { status: 'open' }, { from: date, to: date }, { status: 'paid', from: date, to: date }]) {
    const result = await fetchInvoicePage(client, { ...options, pageSize: 25 });
    const reference = expected(options);
    assert.equal(result.total, reference.length);
    assert.deepEqual(result.rows.map(row => row.id), reference.slice(0, 25).map(row => row.id));
  }
});

test('empty pages return a total, oversized requests are capped, and anonymous callers are refused', async () => {
  const beyond = await fetchInvoicePage(client, { page: 100000 });
  assert.deepEqual(beyond.rows, []);
  assert.equal(beyond.total, expected().length);
  assert.equal((await fetchInvoicePage(client, { pageSize: 10000 })).rows.length, 100);
  const anon = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await anon.rpc('invoice_list_page');
  assert.ok(error, 'Anonymous access must be denied.');
});

test('PDF selection retrieves fresh records across pages in selection order', async () => {
  const reference = expected();
  const ids = [reference[70].id, reference[0].id, reference[120].id];
  const selected = await fetchSelectedInvoices(client, ids);
  assert.deepEqual(selected.map(inv => inv.id), ids);
  assert.ok(selected.every(inv => inv.lines !== undefined && inv.customer !== undefined));
  await assert.rejects(fetchSelectedInvoices(client, ['00000000-0000-4000-8000-000000000000']), /no longer available/);
});
