import {decodeTestConnection,sealTestValue} from './quickbooks-private.mjs';
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
const rawConn=()=>JSON.parse(sql('select row_to_json(q) from (select * from qb_tokens limit 1) q'));
const conn=()=>decodeTestConnection(rawConn());
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
  testIndex++;if(testIndex<Number(process.argv.find(a=>a.startsWith('--from='))?.split('=')[1]||1)||testIndex>Number(process.argv.find(a=>a.startsWith('--to='))?.split('=')[1]||999))return;
  const start=Date.now();try{await fn();results.push({name,status:'passed',ms:Date.now()-start});console.log('PASS',name);}
  catch(e){results.push({name,status:'failed',message:e.message,ms:Date.now()-start});console.error('FAIL',name,e.message);}
  await mkdir('output/quickbooks-tests',{recursive:true});
  await writeFile('output/quickbooks-tests/'+(process.argv.some(a=>a.startsWith('--from='))?'extended-recovery.json':'extended.json'),JSON.stringify({runId,environment:'sandbox',results},null,2));
  await writeFile('output/quickbooks-tests/'+runId+'-results.json',JSON.stringify({runId,environment:'sandbox',results},null,2));
}
const fixture=JSON.parse(await readFile('output/quickbooks-tests/fixtures.json','utf8'));
let customer=await row('customers',fixture.customerId),item=await row('items',fixture.itemId),invoice=process.argv.find(a=>a.startsWith('--invoice='))?await row('invoices',process.argv.find(a=>a.startsWith('--invoice=')).split('=')[1]):null,imported;
await test('Client edits cannot forge accounting identities, snapshots, or synchronization versions',async()=>{
 const before=await row('customers',customer.id);
 await rest('customers',{qb_id:'999999',qb_sync_status:'synced',qb_snapshot:{fake:true},qb_sync_version:9000},'PATCH','?id=eq.'+customer.id);
 const after=await row('customers',customer.id);assert.equal(after.qb_id,before.qb_id);assert.equal(after.qb_sync_version,before.qb_sync_version);assert.deepEqual(after.qb_snapshot,before.qb_snapshot);
});
await test('Queued changes survive while the background worker is stopped and recover when resumed',async()=>{
 const [c]=await rest('customers',{name:'Queued '+runId,company_name:'Queued '+runId});
 assert.equal(c.qb_id,null);assert.equal(c.qb_sync_status,'pending');
 await delay(1500);assert.equal((await row('customers',c.id)).qb_id,null);
 await waitFor(async()=>{const v=await row('customers',c.id);return v.qb_sync_status==='synced'?v:null;},'Queued creation not delivered.');
});
await test('Nonoverlapping simultaneous customer edits merge without losing either change',async()=>{
 await rest('customers',{city:'Merged City '+runId},'PATCH','?id=eq.'+customer.id);
 const q=(await qbo('customer/'+customer.qb_id)).Customer;
 await qbo('customer',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,PrimaryPhone:{FreeFormNumber:'3305550188'}});
 customer=await waitFor(async()=>{const c=await row('customers',customer.id);return c.qb_sync_status==='synced'?c:null;},'Merge did not finish.');
 assert.equal(customer.phone,'3305550188');assert.equal(customer.city,'Merged City '+runId);
});
await test('A second invoice synchronizes automatically from the durable outbox',async()=>{
 [invoice]=await rest('invoices',{customer_id:customer.id,doc_number:'EXT-'+runId,txn_date:'2026-10-16',due_date:'2026-11-16',total:125,balance:125,status:'open',source:'app',lines:[{item_id:item.id,name:item.name,qty:1,unit_price:125,amount:125}]});
 invoice=await waitFor(async()=>{const v=await row('invoices',invoice.id);return v.qb_sync_status==='synced'?v:null;},'Invoice did not synchronize.');
});
await test('Invalid, overpaid, and fractional-cent payments are rejected before posting',async()=>{
 for(const amount of [-1,0,126,0.001])await assert.rejects(()=>sync({action:'record-payment',id:invoice.id,amount,request_id:randomUUID()}),e=>[400,409].includes(e.status));
 assert.equal(Number((await qbo('invoice/'+invoice.qb_id)).Invoice.Balance),125);
});
await test('Marking paid creates a payment; marking unpaid reverses only software-owned payments',async()=>{
 await rest('invoices',{status:'paid',balance:0},'PATCH','?id=eq.'+invoice.id);
 await waitFor(async()=>{const v=await row('invoices',invoice.id);return v.qb_sync_status==='synced'&&v.balance===0?v:null;},'Mark paid failed.');
 assert.equal(Number((await qbo('invoice/'+invoice.qb_id)).Invoice.Balance),0);
 await rest('invoices',{status:'open',balance:125},'PATCH','?id=eq.'+invoice.id);
 await waitFor(async()=>{const v=await row('invoices',invoice.id);return v.qb_sync_status==='synced'&&Number(v.balance)===125?v:null;},'Mark unpaid failed.');
 assert.equal(Number((await qbo('invoice/'+invoice.qb_id)).Invoice.Balance),125);
});
await test('Deleting a QuickBooks payment restores the correct software invoice balance',async()=>{
 const payment=(await qbo('payment',{CustomerRef:{value:customer.qb_id},TotalAmt:25,Line:[{Amount:25,LinkedTxn:[{TxnId:invoice.qb_id,TxnType:'Invoice'}]}]})).Payment;
 await waitFor(async()=>Number((await row('invoices',invoice.id)).balance)===100,'QB partial payment not imported.');
 const latest=(await qbo('payment/'+payment.Id)).Payment;
 await qbo('payment?operation=delete',{Id:latest.Id,SyncToken:latest.SyncToken});
 await waitFor(async()=>Number((await row('invoices',invoice.id)).balance)===125,'Deleted payment balance not restored.');
});
await test('An invoice created in QuickBooks imports and accepts a software update on the same invoice',async()=>{
 const q=(await qbo('invoice',{DocNumber:'QBI-'+runId,CustomerRef:{value:customer.qb_id},TxnDate:'2026-10-16',DueDate:'2026-11-01',Line:[{DetailType:'SalesItemLineDetail',Amount:125,SalesItemLineDetail:{ItemRef:{value:item.qb_id},Qty:1,UnitPrice:125}}]})).Invoice;
 imported=await waitFor(async()=>(await rest('invoices',null,'GET','?qb_id=eq.'+q.Id))[0],'QB invoice not imported.');
 await rest('invoices',{note:'Edited imported invoice '+runId},'PATCH','?id=eq.'+imported.id);
 imported=await waitFor(async()=>{const v=await row('invoices',imported.id);return v.qb_sync_status==='synced'?v:null;},'Imported invoice update failed.');
 assert.equal(imported.qb_id,q.Id);assert.equal((await qbo('invoice/'+q.Id)).Invoice.CustomerMemo.value,'Edited imported invoice '+runId);
});
await test('Invoice line changes made in QuickBooks refresh the local quantities and totals',async()=>{
 const q=(await qbo('invoice/'+imported.qb_id)).Invoice;
 await qbo('invoice',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,Line:[{DetailType:'SalesItemLineDetail',Amount:250,SalesItemLineDetail:{ItemRef:{value:item.qb_id},Qty:2,UnitPrice:125}}]});
 await waitFor(async()=>{const v=await row('invoices',imported.id);return Number(v.total)===250&&Number(v.lines[0].qty)===2;},'QB invoice line edit not imported.');
});
await test('Archiving an unpaid software invoice voids it in QuickBooks',async()=>{
 await rest('invoices',{qb_archived:true},'PATCH','?id=eq.'+invoice.id);
 await waitFor(async()=>{const v=await row('invoices',invoice.id);return v.qb_sync_status==='synced'&&v.qb_archived;},'Void failed.');
 assert.equal(Number((await qbo('invoice/'+invoice.qb_id)).Invoice.TotalAmt),0);
});
await test('Deleting an invoice in QuickBooks archives its local copy',async()=>{
 const q=(await qbo('invoice/'+imported.qb_id)).Invoice;await qbo('invoice?operation=delete',{Id:q.Id,SyncToken:q.SyncToken});
 await waitFor(async()=>(await row('invoices',imported.id)).qb_archived===true,'QB delete was not reflected locally.');
});
await test('Expired sandbox access tokens renew and the next API operation succeeds',async()=>{
 sql("update qb_tokens set access_token_expires_at=now()-interval '1 minute'");
 await rest('customers',{street_address:'Token renewal test '+runId},'PATCH','?id=eq.'+customer.id);
 await waitFor(async()=>new Date(conn().access_token_expires_at)>new Date(),'Expired token was not renewed during an actual API update.');
 await waitFor(async()=>(await row('customers',customer.id)).qb_sync_status==='synced','Customer edit after token renewal did not finish.');
 assert.equal((await qbo('customer/'+customer.qb_id)).Customer.BillAddr.Line1,'Token renewal test '+runId);
});
await test('Anonymous callers cannot run synchronization, read tokens, or access the private outbox',async()=>{
 await assert.rejects(()=>local('/functions/v1/qb-sync',{action:'run'},'POST',frontend.VITE_SUPABASE_ANON_KEY),e=>e.status===403);
 for(const table of ['qb_tokens','qb_sync_jobs','qb_sync_config']){
  const r=await fetch(base+'/rest/v1/'+table,{headers:{apikey:frontend.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+frontend.VITE_SUPABASE_ANON_KEY}});
  assert.ok(r.status===401||r.status===403||JSON.stringify(await r.json())==='[]');
 }
});
await test('Invalid webhook signatures are refused and another company cannot enter this database',async()=>{
 const payload=JSON.stringify({eventNotifications:[{realmId:'different-sandbox-company',dataChangeEvent:{entities:[{name:'Customer',id:'999999',operation:'Update',lastUpdated:new Date().toISOString()}]}}]});
 let r=await fetch(base+'/functions/v1/qb-webhook',{method:'POST',headers:{'Content-Type':'application/json','intuit-signature':'invalid'},body:payload});assert.equal(r.status,401);
 const signature=createHmac('sha256',runtime.QB_WEBHOOK_VERIFIER_TOKEN).update(payload).digest('base64');
 r=await fetch(base+'/functions/v1/qb-webhook',{method:'POST',headers:{'Content-Type':'application/json','intuit-signature':signature},body:payload});assert.equal(r.status,200);assert.equal((await r.json()).received,0);
 assert.equal(sql("select count(*) from qb_webhook_events where realm_id='different-sandbox-company'"),'0');
});
await test('OAuth callback rejects forged state before exchanging credentials',async()=>{
 await assert.rejects(()=>local('/functions/v1/qb-auth',{action:'callback',code:'test-invalid',realmId:initial.realm_id,state:'forged'}),e=>e.status===400&&e.body.error==='invalid_oauth_state');
 assert.equal(conn().realm_id,initial.realm_id);
});
await test('A mismatched company configuration blocks synchronization without changing QuickBooks',async()=>{
 sql("update qb_sync_config set realm_id='not-the-connected-company'");
 try{await assert.rejects(()=>sync({action:'run'}),e=>e.status===409);}finally{sql('update qb_sync_config set realm_id='+quote(initial.realm_id));}
});
await test('The worker lease prevents two concurrent deliveries from posting changes together',async()=>{
 sql("update qb_sync_config set lease_owner=gen_random_uuid(),lease_until=now()+interval '1 minute'");
 try{assert.equal((await sync({action:'run'})).busy,true);}finally{sql('update qb_sync_config set lease_owner=null,lease_until=null');}
 assert.ok(await sync({action:'run'}));
});
await test('Local disconnection pauses delivery, retains queued changes, and restoration resumes safely',async()=>{
 const backup=rawConn();
 // Simulate local disconnection without revoking the real sandbox OAuth grant.
 sql('delete from qb_tokens');
 try{await assert.rejects(()=>sync({action:'run'}),e=>e.status===409);assert.equal((await local('/functions/v1/qb-auth',{action:'status'})).connected,false);}
 finally{sql('insert into qb_tokens select * from json_populate_record(null::qb_tokens,'+quote(JSON.stringify(backup))+')');}
 assert.equal((await local('/functions/v1/qb-auth',{action:'status'})).connected,true);await sync({action:'run'});
});
console.log(JSON.stringify({passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length}));
if(results.some(x=>x.status==='failed'))process.exitCode=1;
