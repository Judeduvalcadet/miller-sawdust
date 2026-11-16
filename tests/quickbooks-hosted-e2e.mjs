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
  await writeFile('output/quickbooks-tests/'+'hosted.json',JSON.stringify({runId,environment:'sandbox',results},null,2));
  await writeFile('output/quickbooks-tests/'+runId+'-results.json',JSON.stringify({runId,environment:'sandbox',results},null,2));
}
const fixture=JSON.parse(await readFile('output/quickbooks-tests/fixtures.json','utf8'));
let customer=await row('customers',fixture.customerId),item=await row('items',fixture.itemId),invoice=process.argv.find(a=>a.startsWith('--invoice='))?await row('invoices',process.argv.find(a=>a.startsWith('--invoice=')).split('=')[1]):null,imported;
const gateway=parseEnv(await readFile('supabase/functions/.env.qb-gateway.local','utf8'));
assert.equal(gateway.QB_SANDBOX_GATEWAY_URL,'https://csrvvapbaicedypoonzs.supabase.co/functions/v1/qb-relay');
assert.equal((await readFile('sandbox-gateway/supabase/.temp/project-ref','utf8')).trim(),'csrvvapbaicedypoonzs');
const otherRealm='gateway-test-'+runId,otherKey=randomUUID()+randomUUID();
async function cloudSql(query){
 const path='/tmp/miller-gateway-test-query.sql';await writeFile(path,query,{mode:0o600});
 const r=spawnSync('supabase',['db','query','--linked','--workdir','sandbox-gateway','--file',path],{encoding:'utf8',timeout:30000});if(r.status)throw Error('Isolated gateway SQL failed: '+r.stderr);
 return JSON.parse(r.stdout).rows;
}
async function relay(action,realm=initial.realm_id,key=gateway.QB_SANDBOX_GATEWAY_KEY,extra={}){
 const r=await fetch(gateway.QB_SANDBOX_GATEWAY_URL,{method:'POST',headers:{'content-type':'application/json','x-jobyard-relay-key':key},body:JSON.stringify({action,realm_id:realm,...extra}),signal:AbortSignal.timeout(15000)});
 const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error),{status:r.status});return d;
}
async function send(payload,to='https://hkdk.events/fcwe0nprkjv5tj',valid=true){
 const raw=JSON.stringify(payload);const r=await fetch(to,{method:'POST',headers:{'content-type':'application/json','intuit-signature':valid?createHmac('sha256',runtime.QB_WEBHOOK_VERIFIER_TOKEN).update(raw).digest('base64'):'invalid'},body:raw,signal:AbortSignal.timeout(15000)});return r.status;
}
async function eventually(fn,message){for(let i=0;i<60;i++){const v=await fn();if(v)return v;await delay(1000);}throw Error(message);}
const notification=(realm,id,time)=>({realmId:realm,dataChangeEvent:{entities:[{name:'Customer',id,operation:'Update',lastUpdated:time}]}});
let mixedPayload;
await test('Hookdeck and the hosted receiver both reject invalid provider signatures',async()=>{
 const p={eventNotifications:[]};assert.equal(await send(p,undefined,false),401);assert.equal(await send(p,gateway.QB_SANDBOX_GATEWAY_URL+'?action=webhook',false),401);
 assert.equal(await send(p),200);
});
await test('Hosted routing separates batched companies before the software receives any event',async()=>{
 const {createHash}=await import('node:crypto');
 await cloudSql('insert into qb_gateway_clients(realm_id,label,key_sha256) values('+quote(otherRealm)+",'Isolation fixture',"+quote(createHash('sha256').update(otherKey).digest('hex'))+')');
 const time=new Date().toISOString();mixedPayload={eventNotifications:[notification(initial.realm_id,customer.qb_id,time),notification(otherRealm,'other-customer',time)]};
 assert.equal(await send(mixedPayload),200);
 await eventually(async()=>{const p=await relay('pull');return p.events.some(e=>new Date(e.source_updated_at).getTime()===new Date(time).getTime()&&e.entity_id===customer.qb_id);},'Current company event was not delivered to hosted inbox.');
 const own=await relay('pull'),other=await relay('pull',otherRealm,otherKey);
 assert.ok(own.events.every(e=>e.realm_id===initial.realm_id));assert.ok(other.events.every(e=>e.realm_id===otherRealm));assert.equal(other.events.length,1);
 await assert.rejects(()=>relay('pull',otherRealm),e=>e.status===403);await assert.rejects(()=>relay('pull',initial.realm_id,otherKey),e=>e.status===403);
 await relay('ack',otherRealm,otherKey,{keys:own.events.map(e=>e.event_key)});
 assert.ok((await relay('pull')).events.length>0);
 await relay('ack',otherRealm,otherKey,{keys:other.events.map(e=>e.event_key)});
});
await test('Duplicate hosted receipts and lost acknowledgements remain safe to redeliver',async()=>{
 assert.equal(await send(mixedPayload),200);assert.equal(await send(mixedPayload),200);
 const first=await relay('pull'),again=await relay('pull');assert.deepEqual(first.events.map(e=>e.event_key),again.events.map(e=>e.event_key));
 assert.equal(new Set(first.events.map(e=>e.event_key)).size,first.events.length);
 await sync({action:'run'});
 assert.ok((await relay('pull')).events.every(e=>!first.events.some(f=>f.event_key===e.event_key)));
 assert.equal((await rest('customers',null,'GET','?qb_id=eq.'+customer.qb_id)).length,1);
});
await test('A real QuickBooks change waits in the hosted inbox while the local worker is offline',async()=>{
 const before=await row('customers',customer.id),q=(await qbo('customer/'+customer.qb_id)).Customer;
 const changed=(await qbo('customer',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,BillAddr:{...q.BillAddr,Line1:'Hosted offline recovery '+runId}})).Customer;
 await eventually(async()=>{const p=await relay('pull');return p.events.some(e=>e.entity_id===q.Id&&new Date(e.source_updated_at)>=new Date(changed.MetaData.LastUpdatedTime));},'Real QBO notification not retained by hosted receiver.');
 assert.equal((await row('customers',customer.id)).street_address,before.street_address);
 await waitFor(async()=>(await row('customers',customer.id)).street_address==='Hosted offline recovery '+runId,'Hosted notification did not recover locally.');
});
await test('Incoming routing failure does not block software-to-QuickBooks invoice or customer writes',async()=>{
 await cloudSql('update qb_gateway_clients set enabled=false where realm_id='+quote(initial.realm_id));
 try{
  const [c]=await rest('customers',{name:'Outbound independence '+runId,company_name:'Outbound independence '+runId});
  const report=await sync({action:'run'});assert.ok(report.relayError);
  const saved=await row('customers',c.id);assert.equal(saved.qb_sync_status,'synced');assert.ok(saved.qb_id);
  assert.equal((await qbo('customer/'+saved.qb_id)).Customer.DisplayName,'Outbound independence '+runId);
 }finally{await cloudSql('update qb_gateway_clients set enabled=true where realm_id='+quote(initial.realm_id));}
});
await test('Hookdeck automatically retries a failed hosted delivery and recovers after the receiver is repaired',async()=>{
 const started=new Date().toISOString();let failedId;
 const args=['gateway','event','list','--connection-id','web_cYb0bC54YFNO','--created-after',started,'--limit','10','--output','json','--hookdeck-config','/tmp/miller-hookdeck-tools/config.toml'];
 const events=()=>{const r=spawnSync('/tmp/miller-hookdeck-tools/node_modules/.bin/hookdeck',args,{encoding:'utf8',timeout:15000});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout).models;};
 await cloudSql('alter table qb_gateway_events add constraint gateway_failure_test check(false) not valid');
 try{
  assert.equal(await send({eventNotifications:[notification(initial.realm_id,customer.qb_id,new Date().toISOString())]}),200);
  failedId=await eventually(async()=>events().find(e=>e.response_status===503)?.id,'Hookdeck did not record the simulated failure.');
 }finally{await cloudSql('alter table qb_gateway_events drop constraint if exists gateway_failure_test');}
 const recovered=await eventually(async()=>events().find(e=>e.id===failedId&&e.status==='SUCCESSFUL'&&e.attempts>=2),'Hookdeck did not retry and recover the failed delivery.');
 assert.ok(recovered.attempts>=2);await sync({action:'run'});
});
await cloudSql('delete from qb_gateway_clients where realm_id='+quote(otherRealm));
console.log(JSON.stringify({passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length}));
if(results.some(x=>x.status==='failed'))process.exitCode=1;
