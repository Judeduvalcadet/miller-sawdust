// Synthetic infrastructure metadata only. Never calls QuickBooks or a client database.
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parseEnv} from 'node:util';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const project='hvryrivqjqsxfcypvqie',base='https://'+project+'.supabase.co';
assert.equal((await readFile('production-gateway/supabase/.temp/project-ref','utf8')).trim(),project);
const cfg=parseEnv(await readFile('.env.production-gateway.local','utf8'));assert.equal(cfg.APP_ENV,'quickbooks_gateway_production');
const out=spawnSync('supabase',['projects','api-keys','--project-ref',project,'-o','json'],{encoding:'utf8'});assert.equal(out.status,0);
const keys=JSON.parse(out.stdout),service=keys.find(k=>k.name==='service_role').api_key,anon=keys.find(k=>k.name==='anon').api_key;
const label='infrastructure-probe-'+randomUUID(),realms=['999999990001','999999990002'],secrets=realms.map(()=>randomBytes(32).toString('hex')),results=[];
const hash=s=>createHash('sha256').update(s).digest('hex');
async function rest(table,method='GET',body,query='',key=service){const r=await fetch(base+'/rest/v1/'+table+query,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
async function relay(index,body){const r=await fetch(base+'/functions/v1/qb-relay',{method:'POST',headers:{'Content-Type':'application/json','x-jobyard-relay-key':secrets[index]},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
const payload=JSON.stringify({eventNotifications:realms.map((realmId,i)=>({realmId,dataChangeEvent:{entities:[{id:label+'-'+i,name:'Invoice',operation:'Update',lastUpdated:new Date().toISOString()}]}}))});
const signature=createHmac('sha256',cfg.QB_WEBHOOK_VERIFIER_TOKEN).update(payload).digest('base64');
async function test(name,fn){try{await fn();results.push({name,status:'passed'});console.log('PASS',name);}catch(e){results.push({name,status:'failed',message:e.message});console.error('FAIL',name,e.message);}await writeFile('output/quickbooks-tests/production-gateway-probes.json',JSON.stringify({environment:'production-infrastructure-only',synthetic:true,results},null,2));}
try{
 for(let i=0;i<2;i++)assert.equal((await rest('qb_gateway_clients','POST',{realm_id:realms[i],label,key_sha256:hash(secrets[i]),environment:'production'})).status,201);
 await test('Hookdeck rejects unsigned and incorrectly signed requests at ingestion',async()=>{for(const headers of [{'Content-Type':'application/json'},{'Content-Type':'application/json','intuit-signature':createHmac('sha256','incorrect-key').update(payload).digest('base64')}]){const r=await fetch('https://hkdk.events/w2x4ind3eopkl2',{method:'POST',headers,body:payload});assert.ok([401,403].includes(r.status),'Hookdeck should reject invalid signatures');}});
 await test('Live gateway rejects unsigned notifications and unknown clients',async()=>{assert.equal((await fetch(base+'/functions/v1/qb-relay?action=webhook',{method:'POST',body:payload})).status,401);assert.equal((await fetch(base+'/functions/v1/qb-relay',{method:'POST',body:'{}'})).status,403);});
 await test('Unregistered production callback fails closed',async()=>{assert.equal((await fetch(base+'/functions/v1/qb-router?state=forged&code=synthetic',{redirect:'manual'})).status,400);});
 await test('Hookdeck delivers a signed mixed-company batch into the production inbox',async()=>{
 const r=await fetch('https://hkdk.events/w2x4ind3eopkl2',{method:'POST',headers:{'Content-Type':'application/json','intuit-signature':signature},body:payload});assert.ok(r.ok);
 let delivered=false;for(let n=0;n<30;n++){if((await relay(0,{action:'pull',realm_id:realms[0]})).body.events?.length){delivered=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}assert.equal(delivered,true);
 });
 await test('Independent client keys receive only their own company event',async()=>{for(let i=0;i<2;i++){const r=await relay(i,{action:'pull',realm_id:realms[i]});assert.equal(r.status,200);assert.equal(r.body.events.length,1);assert.equal(r.body.events[0].realm_id,realms[i]);assert.equal(r.body.events[0].entity_id,label+'-'+i);}assert.equal((await relay(0,{action:'pull',realm_id:realms[1]})).status,403);});
 await test('Unacknowledged notifications survive repeated pulls and duplicates',async()=>{const before=await relay(0,{action:'pull',realm_id:realms[0]});assert.equal(before.body.events.length,1);assert.equal((await fetch(base+'/functions/v1/qb-relay?action=webhook',{method:'POST',headers:{'Content-Type':'application/json','intuit-signature':signature},body:payload})).status,200);const after=await relay(0,{action:'pull',realm_id:realms[0]});assert.equal(after.body.events.length,1);assert.equal(after.body.events[0].event_key,before.body.events[0].event_key);});
 await test('Cross-company acknowledgment cannot consume another company event',async()=>{const other=(await relay(1,{action:'pull',realm_id:realms[1]})).body.events[0];await relay(0,{action:'ack',realm_id:realms[0],keys:[other.event_key]});assert.equal((await relay(1,{action:'pull',realm_id:realms[1]})).body.events.length,1);});
 await test('Successful acknowledgment stays complete after duplicate provider delivery',async()=>{const own=(await relay(0,{action:'pull',realm_id:realms[0]})).body.events[0];assert.equal((await relay(0,{action:'ack',realm_id:realms[0],keys:[own.event_key]})).status,200);await fetch(base+'/functions/v1/qb-relay?action=webhook',{method:'POST',headers:{'Content-Type':'application/json','intuit-signature':signature},body:payload});assert.equal((await relay(0,{action:'pull',realm_id:realms[0]})).body.events.length,0);});
 await test('Anonymous clients cannot read routing keys or notifications',async()=>{for(const table of ['qb_gateway_clients','qb_gateway_events'])assert.ok([401,403].includes((await rest(table,'GET',undefined,'',anon)).status));});
 await test('Disabling one company immediately denies its old delivery key',async()=>{assert.equal((await rest('qb_gateway_clients','PATCH',{enabled:false},'?realm_id=eq.'+realms[0])).status,200);assert.equal((await relay(0,{action:'pull',realm_id:realms[0]})).status,403);assert.equal((await relay(1,{action:'pull',realm_id:realms[1]})).status,200);});
}finally{
 const query='?realm_id=in.('+realms.join(',')+')';
 assert.equal((await rest('qb_gateway_events','DELETE',undefined,query)).status,200);
 assert.equal((await rest('qb_gateway_clients','DELETE',undefined,'?label=eq.'+label)).status,200);
}
console.log(JSON.stringify({passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length}));if(results.some(r=>r.status==='failed'))process.exitCode=1;
