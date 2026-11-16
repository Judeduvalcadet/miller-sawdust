import {decodeTestConnection} from './quickbooks-private.mjs';
// Real QBO sandbox integration tests. Never accepts a remote database or a
// production API hostname. Secrets stay in process memory, not in the report.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const frontend=parseEnv(await readFile('.env.sandbox.local','utf8'));
const runtime=parseEnv(await readFile('supabase/functions/.env.sandbox-runtime.local','utf8'));
assert.equal(frontend.VITE_SUPABASE_URL,'http://127.0.0.1:54521');
assert.equal(runtime.APP_ENV,'sandbox');assert.equal(runtime.QB_ENVIRONMENT,'sandbox');
const resume=process.argv.includes('--resume');
const fixtures=resume?JSON.parse(await readFile('output/quickbooks-tests/fixtures.json','utf8')):null;
const base=frontend.VITE_SUPABASE_URL,runId=fixtures?.runId||randomUUID().slice(0,8),results=[];
let testIndex=0;
export const sql=query=>{const r=spawnSync('docker',['exec','supabase_db_miller-sawdust','psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atc',query],{encoding:'utf8'});if(r.status)throw new Error(r.stderr);return r.stdout.trim();};
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const conn=()=>decodeTestConnection(JSON.parse(sql('select row_to_json(q) from (select * from qb_tokens limit 1) q')));
const initial=conn();assert.equal(initial.realm_id,sql('select realm_id from qb_sync_config where enabled'));
let session;
async function local(path,body,method='POST',token=session?.access_token){
  const r=await fetch(base+path,{method,signal:AbortSignal.timeout(60000),headers:{apikey:frontend.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+(token||frontend.VITE_SUPABASE_ANON_KEY),'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json().catch(()=>null);if(!r.ok)throw Object.assign(new Error(`Local ${r.status}: ${JSON.stringify(data)}`),{status:r.status,body:data});return data;
}
const credentials=JSON.parse(await readFile('.env.office-sandbox.local','utf8'));
session=await local('/functions/v1/login',credentials);
const sync=body=>local('/functions/v1/qb-sync',body);
const rest=(table,body,method='POST',query='')=>local('/rest/v1/'+table+query,body,method);
async function qbo(path,body,key){
  const c=conn();assert.equal(c.realm_id,initial.realm_id);
  const url=new URL('https://sandbox-quickbooks.api.intuit.com/v3/company/'+encodeURIComponent(c.realm_id)+'/'+path);
  url.searchParams.set('minorversion','73');if(key)url.searchParams.set('requestid',key);
  assert.equal(url.hostname,'sandbox-quickbooks.api.intuit.com');
  const r=await fetch(url,{method:body?'POST':'GET',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+c.access_token,Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok||data.Fault)throw new Error('Sandbox API: '+JSON.stringify(data.Fault));return data;
}
const row=async(table,id)=>(await rest(table,null,'GET','?id=eq.'+id))[0];
async function waitFor(fn,message){
  for(let attempt=0;attempt<25;attempt++){await sync({action:'run'});const value=await fn();if(value)return value;await delay(1000);}
  throw new Error(message);
}
async function test(name,fn){
  testIndex++;if(resume&&testIndex<10)return;
  const start=Date.now();try{await fn();results.push({name,status:'passed',ms:Date.now()-start});console.log('PASS',name);}
  catch(e){results.push({name,status:'failed',message:e.message,ms:Date.now()-start});console.error('FAIL',name,e.message);}
  await mkdir('output/quickbooks-tests',{recursive:true});
  await writeFile('output/quickbooks-tests/'+(resume?'recovery.json':'latest.json'),JSON.stringify({runId,environment:'sandbox',results},null,2));
  await writeFile('output/quickbooks-tests/'+runId+'-results.json',JSON.stringify({runId,environment:'sandbox',results},null,2));
}
let customer=resume?await row('customers',fixtures.customerId):null,invoice=resume?await row('invoices',fixtures.invoiceId):null,item=resume?await row('items',fixtures.itemId):null,remoteExisting=resume?(await qbo('customer/'+fixtures.existingQuickbooksCustomerId)).Customer:null;
await test('Local customer creation queues automatically and creates the QBO customer with full billing address',async()=>{
  [customer]=await rest('customers',{name:'Sandbox Contact '+runId,company_name:'JobYard E2E '+runId,street_address:'100 Test Lane',city:'Millersburg',state:'OH',zip_code:'44654',country:'USA',phone:'3305550123',email:'sandbox-'+runId+'@example.com'});
  assert.equal(customer.qb_sync_status,'pending');
  customer=await waitFor(async()=>{const c=await row('customers',customer.id);return c.qb_sync_status==='synced'?c:null;},'Customer did not synchronize.');
  const q=(await qbo('customer/'+customer.qb_id)).Customer;
  assert.equal(q.BillAddr.Line1,'100 Test Lane');assert.equal(q.BillAddr.City,'Millersburg');assert.equal(q.BillAddr.CountrySubDivisionCode,'OH');assert.equal(q.BillAddr.PostalCode,'44654');assert.equal(q.PrimaryEmailAddr.Address,'sandbox-'+runId+'@example.com');
});
await test('Editing a mapped customer updates the same QBO ID and preserves unrelated QuickBooks notes',async()=>{
  let q=(await qbo('customer/'+customer.qb_id)).Customer;
  q=(await qbo('customer',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,Notes:'Keep this QuickBooks-only note'})).Customer;
  await rest('customers',{city:'Berlin',street_address:'200 Updated Lane'},'PATCH','?id=eq.'+customer.id);
  customer=await waitFor(async()=>{const c=await row('customers',customer.id);return c.qb_sync_status==='synced'&&c.city==='Berlin'?c:null;},'Mapped edit did not synchronize.');
  const updated=(await qbo('customer/'+q.Id)).Customer;assert.equal(updated.Id,q.Id);assert.equal(updated.BillAddr.Line1,'200 Updated Lane');assert.equal(updated.Notes,'Keep this QuickBooks-only note');
});
await test('A customer created in QuickBooks imports through the real Hookdeck notification route',async()=>{
  remoteExisting=(await qbo('customer',{DisplayName:'QuickBooks Existing '+runId,GivenName:'Existing',FamilyName:runId,BillAddr:{Line1:'300 QB Street',City:'Wooster',CountrySubDivisionCode:'OH',PostalCode:'44691'},PrimaryEmailAddr:{Address:'existing-'+runId+'@example.com'}})).Customer;
  const c=await waitFor(async()=>(await rest('customers',null,'GET','?qb_id=eq.'+remoteExisting.Id))[0],'QuickBooks customer notification was not imported.');
  assert.equal(c.street_address,'300 QB Street');assert.equal(c.zip_code,'44691');
  await rest('customers',{street_address:'301 Software Update'},'PATCH','?id=eq.'+c.id);
  await waitFor(async()=>{const current=await row('customers',c.id);return current.qb_sync_status==='synced'?current:null;},'Existing QB customer did not accept software edit.');
  assert.equal((await qbo('customer/'+remoteExisting.Id)).Customer.BillAddr.Line1,'301 Software Update');
});
await test('Changes made directly in QuickBooks update the software customer address and phone',async()=>{
  let q=(await qbo('customer/'+customer.qb_id)).Customer;
  await qbo('customer',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,BillAddr:{...q.BillAddr,Line1:'400 From QuickBooks'},PrimaryPhone:{FreeFormNumber:'3305550199'}});
  customer=await waitFor(async()=>{const c=await row('customers',customer.id);return c.street_address==='400 From QuickBooks'?c:null;},'QuickBooks address update not imported.');
  assert.equal(customer.phone,'3305550199');
});
await test('Archiving and reactivating a customer propagates in both directions without deleting history',async()=>{
  await rest('customers',{active:false},'PATCH','?id=eq.'+customer.id);
  await waitFor(async()=>{const c=await row('customers',customer.id);return c.qb_sync_status==='synced'&&c.active===false?c:null;},'Customer archive not synchronized.');
  let q=(await qbo('customer/'+customer.qb_id)).Customer;assert.equal(q.Active,false);
  await qbo('customer',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,Active:true});
  customer=await waitFor(async()=>{const c=await row('customers',customer.id);return c.active===true?c:null;},'QuickBooks reactivation not imported.');
});
await test('New software invoice automatically creates the QBO invoice, customer/item mappings, dates, and amounts',async()=>{
  [item]=await rest('items',{name:'E2E Delivery '+runId,unit_price:125,item_type:'Service',active:true});
  [invoice]=await rest('invoices',{customer_id:customer.id,doc_number:'E2E-'+runId,txn_date:'2026-10-16',due_date:'2026-11-15',total:250,balance:250,status:'open',source:'app',note:'Sandbox invoice note',lines:[{item_id:item.id,name:item.name,qty:2,unit_price:125,amount:250}]});
  invoice=await waitFor(async()=>{const inv=await row('invoices',invoice.id);return inv.qb_sync_status==='synced'?inv:null;},'Invoice did not synchronize: '+(await row('invoices',invoice.id)).qb_sync_error);
  const q=(await qbo('invoice/'+invoice.qb_id)).Invoice;assert.equal(Number(q.TotalAmt),250);assert.equal(q.CustomerRef.value,customer.qb_id);assert.equal(q.DueDate,'2026-11-15');assert.equal(q.Line[0].SalesItemLineDetail.Qty,2);
});
await test('Editing a software invoice updates its existing QBO invoice without duplication',async()=>{
  const original=invoice.qb_id;
  await rest('invoices',{note:'Updated invoice memo',total:375,balance:375,lines:[{item_id:item.id,name:item.name,qty:3,unit_price:125,amount:375}]},'PATCH','?id=eq.'+invoice.id);
  invoice=await waitFor(async()=>{const inv=await row('invoices',invoice.id);return inv.qb_sync_status==='synced'&&Number(inv.total)===375?inv:null;},'Invoice edit did not synchronize.');
  assert.equal(invoice.qb_id,original);const q=(await qbo('invoice/'+original)).Invoice;assert.equal(Number(q.TotalAmt),375);assert.equal(q.CustomerMemo.value,'Updated invoice memo');
});
await test('Partial payment recorded from the software updates QBO and is idempotent when submitted twice',async()=>{
  const request_id=randomUUID();
  await sync({action:'record-payment',id:invoice.id,amount:100,request_id});
  await sync({action:'record-payment',id:invoice.id,amount:100,request_id});
  invoice=await row('invoices',invoice.id);assert.equal(Number(invoice.balance),275);
  assert.equal(Number((await qbo('invoice/'+invoice.qb_id)).Invoice.Balance),275);
});
await test('A payment entered in QuickBooks reaches the software and marks the invoice paid',async()=>{
  const q=(await qbo('invoice/'+invoice.qb_id)).Invoice;
  await qbo('payment',{CustomerRef:q.CustomerRef,TotalAmt:Number(q.Balance),Line:[{Amount:Number(q.Balance),LinkedTxn:[{TxnId:q.Id,TxnType:'Invoice'}]}]});
  invoice=await waitFor(async()=>{const inv=await row('invoices',invoice.id);return inv.status==='paid'?inv:null;},'Payment event did not mark local invoice paid.');
  assert.equal(Number(invoice.balance),0);
});
await test('Duplicate and older webhook notifications do not duplicate records or overwrite the latest data',async()=>{
  const payload=JSON.stringify({eventNotifications:[{realmId:initial.realm_id,dataChangeEvent:{entities:[{name:'Customer',id:customer.qb_id,operation:'Update',lastUpdated:'2026-10-15T10:00:00Z'}]}}]});
  const signature=createHmac('sha256',runtime.QB_WEBHOOK_VERIFIER_TOKEN).update(payload).digest('base64');
  for(let i=0;i<2;i++){const r=await fetch(base+'/functions/v1/qb-webhook',{method:'POST',headers:{'Content-Type':'application/json','intuit-signature':signature},body:payload});assert.equal(r.status,200);}
  await sync({action:'run'});const matching=await rest('customers',null,'GET','?qb_id=eq.'+customer.qb_id);assert.equal(matching.length,1);assert.equal(matching[0].street_address,'400 From QuickBooks');
});
await test('Concurrent edits to the same customer field are flagged instead of silently losing either edit',async()=>{
  customer=await row('customers',customer.id);
  await rest('customers',{city:'Software Conflict'},'PATCH','?id=eq.'+customer.id);
  const q=(await qbo('customer/'+customer.qb_id)).Customer;
  await qbo('customer',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,BillAddr:{...q.BillAddr,City:'QuickBooks Conflict'}});
  await sync({action:'run'});const c=await row('customers',customer.id);assert.equal(c.qb_sync_status,'error');assert.match(c.qb_sync_error,/Both systems changed city/);assert.equal(c.city,'Software Conflict');
  await sync({action:'retry',entity:'customers',id:c.id,resolution:'quickbooks'});
  assert.equal((await row('customers',c.id)).city,'QuickBooks Conflict');
});
await test('Worker retries remain in the local queue and frontend-visible state after an invalid customer name',async()=>{
  const original='JobYard E2E '+runId;
  await rest('customers',{company_name:remoteExisting.DisplayName},'PATCH','?id=eq.'+customer.id);
  await sync({action:'run'});const failed=await row('customers',customer.id);assert.equal(failed.qb_sync_status,'error');assert.ok(failed.qb_sync_error);
  await rest('customers',{company_name:original},'PATCH','?id=eq.'+customer.id);
  await waitFor(async()=>{const c=await row('customers',customer.id);return c.qb_sync_status==='synced'?c:null;},'Corrected customer did not recover.');
});
await writeFile('output/quickbooks-tests/fixtures.json',JSON.stringify({runId,customerId:customer?.id,invoiceId:invoice?.id,itemId:item?.id,quickbooksCustomerId:customer?.qb_id,quickbooksInvoiceId:invoice?.qb_id,existingQuickbooksCustomerId:remoteExisting?.Id},null,2));
console.log(JSON.stringify({passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length}));
if(results.some(x=>x.status==='failed'))process.exitCode=1;
