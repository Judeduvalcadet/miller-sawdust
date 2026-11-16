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
  await writeFile('output/quickbooks-tests/'+'authorization.json',JSON.stringify({runId,environment:'sandbox',results},null,2));
  await writeFile('output/quickbooks-tests/'+runId+'-results.json',JSON.stringify({runId,environment:'sandbox',results},null,2));
}
const fixture=JSON.parse(await readFile('output/quickbooks-tests/fixtures.json','utf8'));
let customer=await row('customers',fixture.customerId),item=await row('items',fixture.itemId),invoice=process.argv.find(a=>a.startsWith('--invoice='))?await row('invoices',process.argv.find(a=>a.startsWith('--invoice=')).split('=')[1]):null,imported;
await test('A rejected refresh token is shown as expired and recovers after valid sandbox credentials are restored',async()=>{
 const backup=rawConn();
 sql("update qb_tokens set refresh_token="+quote(sealTestValue('invalid-sandbox-test-token','refresh_token'))+",access_token_expires_at=now()-interval '1 minute'");
 try{const result=await local('/functions/v1/qb-auth',{action:'status'});assert.equal(result.tokenExpired,true);}
 finally{sql('update qb_tokens set refresh_token='+quote(backup.refresh_token)+',access_token='+quote(backup.access_token)+',access_token_expires_at='+quote(backup.access_token_expires_at));}
 const after=await local('/functions/v1/qb-auth',{action:'status'});assert.equal(after.connected,true);assert.equal(after.tokenExpired,false);
 assert.ok((await qbo('companyinfo/'+initial.realm_id)).CompanyInfo);
});
await test('OAuth state binds to the office user, audience, and expiration',async()=>{
 const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url'));
 for(const patch of [{sub:randomUUID()},{aud:'incorrect-audience'},{exp:Math.floor(Date.now()/1000)-60}]){
  const payload={sub:claims.sub,aud:'quickbooks-oauth',environment:'sandbox',nonce:randomUUID(),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...patch};
  const body=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
  const state=body+'.'+createHmac('sha256',runtime.QB_CLIENT_SECRET).update(body).digest('base64url');
  await assert.rejects(()=>local('/functions/v1/qb-auth',{action:'callback',code:'invalid-test-code',realmId:initial.realm_id,state}),e=>e.status===400&&e.body.error==='invalid_oauth_state');
 }
});
console.log(JSON.stringify({passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length}));
if(results.some(x=>x.status==='failed'))process.exitCode=1;
