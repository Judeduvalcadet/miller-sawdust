import test from 'node:test';import assert from 'node:assert/strict';
import {invoiceBillTo} from '../src/lib/invoiceBillTo.js';
test('a customer address edit does not rewrite a mapped invoice billing address',()=>{
 const saved={company_name:'Original company',street_address:'Original address',street_extra:['Suite 2'],city:'Original city'};
 assert.deepEqual(invoiceBillTo({qb_bill_to:saved},{street_address:'New address',city:'New city'}),saved);
});
test('drafts use current customer details while an explicitly empty saved billing address stays empty',()=>{
 const customer={street_address:'Current address'};assert.equal(invoiceBillTo({},customer),customer);assert.deepEqual(invoiceBillTo({qb_bill_to:{}},customer),{});
});
