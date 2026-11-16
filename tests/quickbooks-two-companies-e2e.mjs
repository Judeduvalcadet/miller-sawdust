// Two real QuickBooks sandbox companies and two local Supabase databases.
// Refuses hosted application databases and production accounting API hosts.
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {createDecipheriv,createHmac,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
const bRoot=homedir()+'/.config/jobyard/testing/company-b';
const run=Date.now().toString(36), results=[];
const sql=(c,text)=>{const r=spawnSync('docker',['exec','-i',c.container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],{input:text,encoding:'utf8'});if(r.status)throw Error('Local test database query failed');return r.stdout.trim();};
const companies=[
 {label:'A',base:'http://127.0.0.1:54521',container:'supabase_db_miller-sawdust',runtimePath:'supabase/functions/.env.sandbox-runtime.local',frontendPath:'.env.sandbox.local',loginPath:'.env.office-sandbox.local',realm:'9341456773684558'},
 {label:'B',base:'http://127.0.0.1:54621',container:'supabase_db_jobyard-company-b',runtimePath:bRoot+'/.env.runtime.local',frontendPath:bRoot+'/.env.sandbox.local',loginPath:bRoot+'/.env.office.local',realm:'9341458524413544'},
];
for(const c of companies){
 c.runtime=parseEnv(await readFile(c.runtimePath,'utf8'));c.frontend=parseEnv(await readFile(c.frontendPath,'utf8'));
 c.runtime.QB_TOKEN_KEYS=c.runtime.QB_TOKEN_KEYS.replaceAll('\\"','"');
 assert.equal(c.frontend.VITE_SUPABASE_URL,c.base);assert.equal(c.runtime.APP_ENV,'sandbox');assert.equal(c.runtime.QB_ENVIRONMENT,'sandbox');assert.equal(c.runtime.MESSAGING_SEND_ENABLED,'false');
 c.headers={apikey:c.frontend.VITE_SUPABASE_ANON_KEY,'content-type':'application/json',Prefer:'return=representation'};
 const r=await fetch(c.base+'/functions/v1/login',{method:'POST',headers:{...c.headers,Authorization:'Bearer '+c.frontend.VITE_SUPABASE_ANON_KEY},body:await readFile(c.loginPath,'utf8')});assert.equal(r.status,200);
 const s=await r.json();c.headers.Authorization='Bearer '+s.access_token;
}
function connection(c){const row=JSON.parse(sql(c,'select row_to_json(t) from (select * from qb_tokens limit 1)t;'));const keys=JSON.parse(c.runtime.QB_TOKEN_KEYS);for(const col of ['realm_id','access_token','refresh_token']){const [v,k,iv,body]=row[col].split('.');assert.equal(v,'jv1');const data=Buffer.from(body,'base64');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(keys[k],'base64'),Buffer.from(iv,'base64'));decipher.setAAD(Buffer.from(c.runtime.QB_INSTALLATION_ID+':'+col));decipher.setAuthTag(data.subarray(-16));row[col]=Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]).toString();}assert.equal(row.realm_id,c.realm);return row;}
async function api(c,path,body,method=body?'POST':'GET',headers=c.headers){const r=await fetch(c.base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error('Local test '+c.label+' HTTP '+r.status+': '+(data.error||'request failed'));return data;}
const sync=(c,body)=>api(c,'/functions/v1/qb-sync',body);
const row=(c,table,id)=>api(c,'/rest/v1/'+table+'?id=eq.'+id).then(rows=>rows[0]);
async function remote(c,path,body){const connectionRow=connection(c),u=new URL('https://sandbox-quickbooks.api.intuit.com/v3/company/'+c.realm+'/'+path);u.searchParams.set('minorversion','73');assert.equal(u.hostname,'sandbox-quickbooks.api.intuit.com');const r=await fetch(u,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+connectionRow.access_token,'content-type':'application/json',accept:'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok||data.Fault)throw Error('QuickBooks sandbox request rejected');return data;}
async function eventually(c,read,label){for(let i=0;i<35;i++){await sync(c,{action:'run'});const r=await read();if(r)return r;await new Promise(r=>setTimeout(r,1000));}throw Error(label);}
async function test(name,fn){try{await fn();results.push({name,status:'passed'});console.log('PASS',name);}catch(e){results.push({name,status:'failed',message:e.message});console.error('FAIL',name,e.message);}await writeFile('output/quickbooks-tests/two-companies.json',JSON.stringify({environment:'two-real-qbo-sandboxes-two-local-databases',run,results},null,2));}
const [a,b]=companies;
await test('Independent installations have different company bindings, encryption keys and OAuth state keys',async()=>{
 for(const c of companies)assert.equal(connection(c).realm_id,c.realm);
 assert.notEqual(a.runtime.QB_TOKEN_KEYS,b.runtime.QB_TOKEN_KEYS);assert.notEqual(a.runtime.QB_OAUTH_STATE_SECRET,b.runtime.QB_OAUTH_STATE_SECRET);assert.notEqual(a.runtime.QB_INSTALLATION_ID,b.runtime.QB_INSTALLATION_ID);
});
await test('Both installations automatically create their own customer with distinct billing addresses',async()=>{
 for(const c of companies){[c.customer]=await api(c,'/rest/v1/customers',{name:'Isolation '+run,company_name:'Isolation '+run,street_address:c.label==='A'?'111 Company A Lane':'222 Company B Lane',city:c.label==='A'?'Berlin':'Wooster',state:'OH',zip_code:c.label==='A'?'44610':'44691',email:`test-${c.label.toLowerCase()}@example.com`});c.customer=await eventually(c,async()=>{const v=await row(c,'customers',c.customer.id);return v.qb_sync_status==='synced'?v:null;},'Customer did not synchronize');assert.equal((await remote(c,'customer/'+c.customer.qb_id)).Customer.BillAddr.Line1,c.customer.street_address);}
 assert.notEqual(a.customer.id,b.customer.id);assert.equal(sql(a,"select count(*) from customers where id='"+b.customer.id+"';"),'0');assert.equal(sql(b,"select count(*) from customers where id='"+a.customer.id+"';"),'0');
});
await test('Editing Company B changes its existing accounting customer while Company A stays unchanged',async()=>{
 await api(b,'/rest/v1/customers?id=eq.'+b.customer.id,{street_address:'223 Company B Updated Lane'},'PATCH');
 await eventually(b,async()=>(await row(b,'customers',b.customer.id)).qb_sync_status==='synced','Company B update failed');
 assert.equal((await remote(b,'customer/'+b.customer.qb_id)).Customer.BillAddr.Line1,'223 Company B Updated Lane');assert.equal((await remote(a,'customer/'+a.customer.qb_id)).Customer.BillAddr.Line1,'111 Company A Lane');
});
await test('Both installations automatically create invoices in only their own QuickBooks company',async()=>{
 for(const c of companies){[c.item]=await api(c,'/rest/v1/items',{name:'Isolation Service '+run,description:'Sandbox only',unit_price:100,item_type:'Service'});[c.invoice]=await api(c,'/rest/v1/invoices',{customer_id:c.customer.id,doc_number:'ISO-'+c.label+'-'+run,txn_date:'2026-10-19',due_date:'2026-11-19',total:100,balance:100,status:'open',source:'app',lines:[{item_id:c.item.id,name:c.item.name,qty:1,unit_price:100,amount:100}]});c.invoice=await eventually(c,async()=>{const v=await row(c,'invoices',c.invoice.id);return v.qb_sync_status==='synced'?v:null;},'Invoice did not synchronize');const q=(await remote(c,'invoice/'+c.invoice.qb_id)).Invoice;assert.equal(q.CustomerRef.value,c.customer.qb_id);assert.equal(q.DocNumber,c.invoice.doc_number);assert.equal(Number(q.TotalAmt),100);}
});
await test('A Company B payment cannot change Company A invoice balance',async()=>{
 await sync(b,{action:'record-payment',id:b.invoice.id,amount:25,request_id:randomUUID()});
 assert.equal(Number((await remote(b,'invoice/'+b.invoice.qb_id)).Invoice.Balance),75);assert.equal(Number((await remote(a,'invoice/'+a.invoice.qb_id)).Invoice.Balance),100);
});
await test('Real Hookdeck mixed-company notifications update only the matching local database',async()=>{
 for(const c of companies){const q=(await remote(c,'customer/'+c.customer.qb_id)).Customer;await remote(c,'customer',{Id:q.Id,SyncToken:q.SyncToken,sparse:true,BillAddr:{...q.BillAddr,Line1:'From QuickBooks '+c.label+' '+run}});}
 const body=JSON.stringify({eventNotifications:companies.map(c=>({realmId:c.realm,dataChangeEvent:{entities:[{name:'Customer',id:c.customer.qb_id,operation:'Update',lastUpdated:new Date().toISOString()}]}}))});
 const r=await fetch('https://hkdk.events/fcwe0nprkjv5tj',{method:'POST',headers:{'content-type':'application/json','intuit-signature':createHmac('sha256',a.runtime.QB_WEBHOOK_VERIFIER_TOKEN).update(body).digest('base64')},body});assert.equal(r.status,200);
 for(const c of companies){await eventually(c,async()=>(await row(c,'customers',c.customer.id)).street_address==='From QuickBooks '+c.label+' '+run,'Notification did not reach its company');assert.equal(sql(c,"select count(*) from customers where qb_realm_id is not null and qb_realm_id<>'"+c.realm+"';"),'0');}
});
await test('A stopped Company B retains changes while Company A continues; restoring B recovers its queue',async()=>{
 sql(b,'update qb_sync_config set enabled=false;');
 try{await api(b,'/rest/v1/customers?id=eq.'+b.customer.id,{phone:'3305550144'},'PATCH');await assert.rejects(()=>sync(b,{action:'run'}));await api(a,'/rest/v1/customers?id=eq.'+a.customer.id,{phone:'3305550155'},'PATCH');await eventually(a,async()=>(await row(a,'customers',a.customer.id)).qb_sync_status==='synced','Company A was blocked');assert.equal((await row(b,'customers',b.customer.id)).qb_sync_status,'pending');}finally{sql(b,'update qb_sync_config set enabled=true;');}
 await eventually(b,async()=>(await row(b,'customers',b.customer.id)).qb_sync_status==='synced','Restored B failed to recover');
});
await test('An office token from one installation cannot call the other installation accounting endpoints',async()=>{
 for(const [own,other]of [[a,b],[b,a]])for(const fn of ['qb-auth','qb-sync']){const r=await fetch(other.base+'/functions/v1/'+fn,{method:'POST',headers:{...other.headers,Authorization:own.headers.Authorization},body:JSON.stringify({action:'status'})});assert.ok([401,403].includes(r.status));}
});
await test('Archiving refuses unpaid balances, then succeeds after settlement without changing Company A or deleting history',async()=>{
 await api(b,'/rest/v1/customers?id=eq.'+b.customer.id,{active:false},'PATCH');
 await eventually(b,async()=>(await row(b,'customers',b.customer.id)).qb_sync_status==='error','Unpaid archive should require attention');
 assert.match((await row(b,'customers',b.customer.id)).qb_sync_error,/open balance/);
 assert.equal((await remote(b,'customer/'+b.customer.qb_id)).Customer.Active,true);
 // Sandbox-only settlement; no real payment is collected or charged.
 await sync(b,{action:'record-payment',id:b.invoice.id,amount:75,request_id:randomUUID()});
 await sync(b,{action:'retry',entity:'customers',id:b.customer.id});
 await eventually(b,async()=>(await row(b,'customers',b.customer.id)).qb_sync_status==='synced','Settled archive did not synchronize');
 assert.equal((await remote(b,'customer/'+b.customer.qb_id)).Customer.Active,false);assert.equal((await remote(a,'customer/'+a.customer.qb_id)).Customer.Active,true);for(const c of companies)assert.ok(await row(c,'invoices',c.invoice.id));
});
await writeFile('output/quickbooks-tests/two-companies-fixtures.json',JSON.stringify(companies.map(c=>({label:c.label,realm:c.realm,customerId:c.customer?.id,invoiceId:c.invoice?.id,streetAddress:'From QuickBooks '+c.label+' '+run})),null,2));
console.log(JSON.stringify({passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length}));if(results.some(r=>r.status==='failed'))process.exitCode=1;
