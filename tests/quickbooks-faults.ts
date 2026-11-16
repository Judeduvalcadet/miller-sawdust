// Inject transport failures in this test process only. Real writes still target
// Intuit's sandbox, and local durable queue state is verified after each fault.
import {service} from '../supabase/functions/_shared/mod.ts';
import {QuickBooksSync} from '../supabase/functions/_shared/quickbooks-sync.ts';
const nativeFetch=globalThis.fetch;
const results:any[]=[];
const check=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data;};
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw Error(message);}
async function office(table:string,body:unknown,id?:string){
 const response=await nativeFetch('http://127.0.0.1:54521/rest/v1/'+table+(id?'?id=eq.'+id:''),{method:id?'PATCH':'POST',headers:{apikey:Deno.env.get('TEST_ANON_KEY')!,authorization:'Bearer '+Deno.env.get('TEST_OFFICE_JWT'),'content-type':'application/json',prefer:'return=representation'},body:JSON.stringify(body)});
 if(!response.ok)throw Error('Local fixture write failed: '+response.status);return (await response.json())[0];
}
async function fixture(){const name='Fault '+crypto.randomUUID().slice(0,8);return office('customers',{name,company_name:name,city:'Before'});}
const read=async(id:string)=>check(await service.from('customers').select('*').eq('id',id).single());
const ready=async(id:string)=>check(await service.from('qb_sync_jobs').update({available_at:new Date().toISOString()}).eq('record_id',id).neq('state','done'));
const customerWrite=(input:RequestInfo|URL,init?:RequestInit)=>String(input).startsWith('https://sandbox-quickbooks.api.intuit.com/')&&new URL(String(input)).pathname.endsWith('/customer')&&init?.method==='POST';
async function test(name:string,fn:()=>Promise<void>){const start=Date.now();try{await fn();results.push({name,status:'passed',ms:Date.now()-start});console.log('PASS',name);}catch(e){results.push({name,status:'failed',message:(e as Error).message});console.error('FAIL',name,(e as Error).message);}finally{globalThis.fetch=nativeFetch;}await Deno.writeTextFile('output/quickbooks-tests/faults.json',JSON.stringify({environment:'sandbox',results},null,2));}
await test('QuickBooks rate limiting retains the job with backoff and recovers without a duplicate customer',async()=>{
 const c=await fixture(),qb=await QuickBooksSync.open();let intercepted=false;
 globalThis.fetch=async(input,init)=>{if(!intercepted&&customerWrite(input,init)&&String(init?.body).includes(c.company_name)){intercepted=true;return new Response(JSON.stringify({Fault:{Error:[{code:'429',Detail:'Injected sandbox rate limit'}]}}),{status:429,headers:{'content-type':'application/json'}});}return nativeFetch(input,init);};
 await qb.drain();assert(intercepted,'Target customer write was not intercepted');assert((await read(c.id)).qb_sync_status==='error','Rate-limited customer should remain in error');
 const job=check(await service.from('qb_sync_jobs').select('*').eq('record_id',c.id).single());assert(job.attempts===1,'First rate-limit failure should count one attempt');assert(new Date(job.available_at)>new Date(),'Retry should have a future backoff time');
 globalThis.fetch=nativeFetch;await ready(c.id);await(await QuickBooksSync.open()).drain();assert((await read(c.id)).qb_sync_status==='synced');
 assert((await qb.query('Customer',"DisplayName = '"+c.company_name+"'")).length===1);
});
await test('A timeout before the QuickBooks write remains queued and recovers on the next attempt',async()=>{
 const c=await fixture();let intercepted=false;
 globalThis.fetch=async(input,init)=>{if(!intercepted&&customerWrite(input,init)&&String(init?.body).includes(c.company_name)){intercepted=true;throw new DOMException('Injected sandbox timeout','TimeoutError');}return nativeFetch(input,init);};
 await(await QuickBooksSync.open()).drain();assert(intercepted);assert(!(await read(c.id)).qb_id);
 globalThis.fetch=nativeFetch;await ready(c.id);await(await QuickBooksSync.open()).drain();assert((await read(c.id)).qb_sync_status==='synced');
});
await test('A lost response after QuickBooks accepts the write retries idempotently instead of creating a second customer',async()=>{
 const c=await fixture();let acceptedId:string|undefined;
 globalThis.fetch=async(input,init)=>{
  const response=await nativeFetch(input,init);
  if(!acceptedId&&customerWrite(input,init)){const data=await response.json();assert(data.Customer?.Id,'Sandbox did not accept the test write.');acceptedId=data.Customer.Id;throw new TypeError('Injected connection loss after successful sandbox write');}
  return response;
 };
 await(await QuickBooksSync.open()).drain();assert(acceptedId);assert(!(await read(c.id)).qb_id);
 globalThis.fetch=nativeFetch;await ready(c.id);const qb=await QuickBooksSync.open();await qb.drain();const recovered=await read(c.id);assert(recovered.qb_id===acceptedId&&recovered.qb_sync_status==='synced');
 assert((await qb.query('Customer',"DisplayName = '"+c.company_name+"'")).length===1);
});
await test('An edit during an in-flight write preserves the new revision and updates the same QuickBooks customer',async()=>{
 const c=await fixture();let acceptedId:string|undefined;
 globalThis.fetch=async(input,init)=>{
  const response=await nativeFetch(input,init);
  if(!acceptedId&&customerWrite(input,init)){
   const data=await response.clone().json();acceptedId=data.Customer?.Id;assert(acceptedId);
   await office('customers',{city:'During flight'},c.id);
  }return response;
 };
 await(await QuickBooksSync.open()).drain();assert(acceptedId);const pending=await read(c.id);assert(pending.qb_id===acceptedId&&pending.city==='During flight'&&pending.qb_sync_status==='pending');
 globalThis.fetch=nativeFetch;const qb=await QuickBooksSync.open();await qb.drain();const final=await read(c.id);assert(final.qb_id===acceptedId&&final.qb_sync_status==='synced');
 assert((await qb.read('Customer',acceptedId!)).BillAddr.City==='During flight');assert((await qb.query('Customer',"DisplayName = '"+c.company_name+"'")).length===1);
});
await test('A stale QuickBooks customer version is re-read and merged once, then updates the same identity',async()=>{
 const c=await fixture();const qb=await QuickBooksSync.open();await qb.drain();const initial=await read(c.id);assert(initial.qb_id);
 await office('customers',{city:'New local city'},c.id);let attempts=0;
 globalThis.fetch=async(input,init)=>{
  if(customerWrite(input,init)&&String(init?.body).includes(initial.qb_id)&&attempts++===0)return new Response(JSON.stringify({Fault:{Error:[{code:'5010'}]}}),{status:400,headers:{'content-type':'application/json'}});
  return nativeFetch(input,init);
 };
 await(await QuickBooksSync.open()).drain();const current=await read(c.id);assert(attempts===2);assert(current.qb_id===initial.qb_id&&current.qb_sync_status==='synced');
 assert((await qb.read('Customer',initial.qb_id)).BillAddr.City==='New local city');
});
await test('An incoming customer notification cannot hide an unresolved outbound failure',async()=>{
 const c=await fixture(),qb=await QuickBooksSync.open();await qb.drain();const initial=await read(c.id);assert(initial.qb_id);
 check(await service.from('customers').update({qb_sync_status:'error',qb_sync_error:'Review before retry'}).eq('id',c.id));
 await qb.importCustomer(await qb.read('Customer',initial.qb_id));const current=await read(c.id);
 assert(current.qb_sync_status==='error'&&current.qb_sync_error==='Review before retry');
 check(await service.from('customers').update({qb_sync_status:'synced',qb_sync_error:null}).eq('id',c.id));
});
if(results.some(r=>r.status==='failed'))Deno.exit(1);
