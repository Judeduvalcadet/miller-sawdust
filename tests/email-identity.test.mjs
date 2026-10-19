import test from 'node:test';
import assert from 'node:assert/strict';
import {emailIdentity} from '../src/lib/emailIdentity.js';
test('Separate company profiles use their own sender and reply address',()=>{
  const a=emailIdentity({company_name:'Company A',email:'office@a.example.com'},'invoices@mail.a.example.com');
  const b=emailIdentity({company_name:'Company B',email:'office@b.example.com'},'invoices@mail.b.example.com');
  assert.equal(a.from,'"Company A" <invoices@mail.a.example.com>');
  assert.equal(b.from,'"Company B" <invoices@mail.b.example.com>');
  assert.equal(a.replyTo,'office@a.example.com');assert.equal(b.replyTo,'office@b.example.com');
});
test('Missing company profile never substitutes Miller branding or its inbox',()=>{
  const v=emailIdentity({},'invoices@mail.new-company.example.com');
  assert.equal(v.name,'invoices@mail.new-company.example.com');assert.equal(v.replyTo,v.name);assert.equal(v.from,v.name);
  assert.deepEqual(emailIdentity(),{name:'',replyTo:'',from:''});
});
