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
async function waitFor(fn,message,limit=25){
  for(let attempt=0;attempt<limit;attempt++){await sync({action:'run'});const value=await fn();if(value)return value;await delay(1000);}
  throw new Error(message);
}
async function test(name,fn){
  testIndex++;if(testIndex<Number(process.argv.find(a=>a.startsWith('--from='))?.split('=')[1]||1)||testIndex>Number(process.argv.find(a=>a.startsWith('--to='))?.split('=')[1]||999))return;
  const start=Date.now();try{await fn();results.push({name,status:'passed',ms:Date.now()-start});console.log('PASS',name);}
  catch(e){results.push({name,status:'failed',message:e.message,ms:Date.now()-start});console.error('FAIL',name,e.message);}
  await mkdir('output/quickbooks-tests',{recursive:true});
  await writeFile('output/quickbooks-tests/'+'resilience.json',JSON.stringify({runId,environment:'sandbox',results},null,2));
  await writeFile('output/quickbooks-tests/'+runId+'-results.json',JSON.stringify({runId,environment:'sandbox',results},null,2));
}
const fixture=JSON.parse(await readFile('output/quickbooks-tests/fixtures.json','utf8'));
let customer=await row('customers',fixture.customerId),item=await row('items',fixture.itemId),invoice=process.argv.find(a=>a.startsWith('--invoice='))?await row('invoices',process.argv.find(a=>a.startsWith('--invoice=')).split('=')[1]):null,imported;
await test('Product catalog edits synchronize in both directions without changing item identity',async()=>{
 const q=(await qbo('item/'+item.qb_id)).Item;
 await qbo('item',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,UnitPrice:140});
 await waitFor(async()=>Number((await row('items',item.id)).unit_price)===140,'QB item price not imported.');
 await rest('items',{description:'Updated software catalog '+runId},'PATCH','?id=eq.'+item.id);
 await waitFor(async()=>(await row('items',item.id)).qb_sync_status==='synced','Item edit not delivered.');
 const updated=(await qbo('item/'+item.qb_id)).Item;assert.equal(updated.Description,'Updated software catalog '+runId);assert.equal(Number(updated.UnitPrice),140);
});
await test('A payment request ID cannot be reused for another amount',async()=>{
 const old=JSON.parse(sql('select row_to_json(q) from (select * from qb_payment_requests limit 1) q'));
 await assert.rejects(()=>sync({action:'record-payment',id:old.invoice_id,amount:Number(old.amount)+1,request_id:old.request_id}),e=>e.status===409&&/cannot be reused/.test(e.body.error));
});
await test('Creating and changing a schedule stays local and creates no accounting delivery job',async()=>{
 const [job]=await rest('jobs',{customer_id:customer.id,customer_company_name:customer.company_name,scheduled_date:'2026-10-20',job_type:'delivery',quantity:1,status:'pending',dispatcher_notes:'Sandbox scheduling test '+runId});
 await rest('jobs',{quantity:2,scheduled_date:'2026-10-21'},'PATCH','?id=eq.'+job.id);
 assert.equal(sql('select count(*) from qb_sync_jobs where record_id='+quote(job.id)),'0');
 assert.equal((await row('jobs',job.id)).scheduled_date,'2026-10-21');
 await rest('jobs',{deleted_at:new Date().toISOString()},'PATCH','?id=eq.'+job.id);
});
await test('Password-authenticated office sessions cannot read tokens or use the worker lease RPC',async()=>{
 for(const table of ['qb_tokens','qb_sync_jobs','qb_sync_config','qb_payment_requests']){
  try{const data=await rest(table,null,'GET');assert.deepEqual(data,[]);}catch(e){assert.ok([401,403].includes(e.status));}
 }
 await assert.rejects(()=>local('/rest/v1/rpc/qb_take_lease',{owner_id:randomUUID()}),e=>[401,403].includes(e.status));
});
await test('PIN sessions and driver sessions cannot access office QuickBooks operations',async()=>{
 const original=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url'));
 for(const patch of [{app_role:'admin',amr:'pin'},{app_role:'driver',amr:'password'}]){
  const payload={...original,...patch,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300};
  const content=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token=content+'.'+createHmac('sha256',runtime.APP_JWT_SECRET).update(content).digest('base64url');
  await assert.rejects(()=>local('/functions/v1/qb-sync',{action:'run'},'POST',token),e=>e.status===403);
  await assert.rejects(()=>local('/functions/v1/qb-auth',{action:'status'},'POST',token),e=>e.status===401);
 }
});
await test('A malformed signed webhook is rejected rather than acknowledged and lost',async()=>{
 const payload=JSON.stringify({eventNotifications:[{realmId:initial.realm_id,dataChangeEvent:{entities:[{name:'Customer',id:customer.qb_id,operation:'Update'}]}}]});
 const signature=createHmac('sha256',runtime.QB_WEBHOOK_VERIFIER_TOKEN).update(payload).digest('base64');
 const r=await fetch(base+'/functions/v1/qb-webhook',{method:'POST',headers:{'Content-Type':'application/json','intuit-signature':signature},body:payload,signal:AbortSignal.timeout(10000)});assert.equal(r.status,400);
});
await test('A paginated reconciliation recovers a missed customer update and finishes its scan',async()=>{
 const remote=(await qbo('customer/'+customer.qb_id)).Customer;
 sql('update customers set city=\'Missed event simulation\' where id='+quote(customer.id));
 await sync({action:'reconcile'});
 await waitFor(async()=>{const health=await sync({action:'status'});return !health.reconciling&&health.notifications===0;},'Reconciliation did not finish within its bounded test window.',120);
 const updated=await row('customers',customer.id);assert.equal(updated.city,remote.BillAddr?.City||'');
 const health=await sync({action:'status'});assert.ok(health.reconciledAt);
});
console.log(JSON.stringify({passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length}));
if(results.some(x=>x.status==='failed'))process.exitCode=1;
