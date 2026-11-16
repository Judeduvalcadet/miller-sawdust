import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceBillTo } from '../src/lib/invoiceBillTo.js';
test('saved app billing snapshot wins over accounting and current customer addresses', () => {
  assert.deepEqual(invoiceBillTo({billing_address: {name:'Payer'}, qb_bill_to:{name:'QB'}}, {name:'Delivery'}), {name:'Payer'});
});
test('legacy invoices retain accounting billing address', () => {
  assert.deepEqual(invoiceBillTo({qb_bill_to:{name:'QB'}}, {name:'Delivery'}), {name:'QB'});
});
import { billingPayload } from '../src/lib/invoiceBilling.js';
const customers = [{id:'delivery',name:'Recipient',street_address:'Old street'}, {id:'payer',name:'Payer',street_address:'Billing street'}];
const job = {customer_id:'delivery',address:'Actual job address'};
test('same-as-shipping uses job location, not customer default address', () => {
  const result = billingPayload({mode:'shipping'},job,customers);
  assert.equal(result.billing_address.street_address,'Actual job address');
  assert.equal(job.customer_id,'delivery');
});
test('existing payer does not change delivery customer used for prices', () => {
  const result = billingPayload({mode:'customer',customer_id:'payer'},job,customers);
  assert.equal(result.billing_address.name,'Payer');
  assert.equal(result.billing_customer_id,'payer');
  assert.equal(job.customer_id,'delivery');
});
test('new billing address requires a name and street', () => {
  assert.throws(() => billingPayload({mode:'address',address:{}},job,customers));
});
test('unchanged saved billing is preserved when editing older invoice', () => {
  assert.equal(billingPayload({mode:'shipping',unchanged:true,address:{street_address:'Original job address'}},job,customers).billing_address.street_address,'Original job address');
});
test('legacy QuickBooks multiline billing survives an unrelated edit', () => {
  const original = {name:'Payer',street_address:'PO Box 42',street_extra:['Accounts payable','Floor 2']};
  const saved = billingPayload({mode:'address',unchanged:true,address:original},job,customers);
  assert.deepEqual(saved.billing_address.street_extra,original.street_extra);
  assert.notEqual(saved.billing_address.street_extra,original.street_extra);
});

import { invoiceBillingPayload } from '../src/lib/invoiceBilling.js';
test('new invoices use the delivery customer saved billing preference', () => {
  const rows = [{...customers[0],billing_preference:{mode:'customer',customer_id:'payer'}},customers[1]];
  assert.equal(invoiceBillingPayload(null,job,rows).billing_address.name,'Payer');
});
test('customer preference never replaces saved invoice billing', () => {
  const invoice={billing_mode:'address',billing_address:{name:'Original payer',street_address:'Original'}};
  assert.deepEqual(invoiceBillingPayload(invoice,job,customers).billing_address,invoice.billing_address);
});
test('legacy invoice without billing snapshot does not adopt new preferences on edit', () => {
  assert.deepEqual(invoiceBillingPayload({id:'legacy'},job,customers),{});
});
test('missing customer cannot silently replace saved billing with shipping', () => {
  assert.throws(() => invoiceBillingPayload(null,job,[]), /Could not load/);
});
