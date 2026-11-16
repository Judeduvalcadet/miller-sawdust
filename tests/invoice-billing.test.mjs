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
