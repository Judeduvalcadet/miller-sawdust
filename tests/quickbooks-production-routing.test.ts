import {SignJWT} from 'npm:jose@5.10.0';
import {createProductionRouter,type Routes} from '../production-gateway/supabase/functions/_shared/router.ts';
import {quickBooksEventRows} from '../production-gateway/supabase/functions/_shared/quickbooks-webhook.ts';
const assert=(value:unknown,message='Assertion failed')=>{if(!value)throw Error(message);};
const routes:Routes={};for(let i=0;i<80;i++)routes['company_'+i]={callback:`https://company-${i}.example.com/api/quickbooks/callback`,key:crypto.randomUUID()+crypto.randomUUID()};
async function state(tenant:string,key:string,environment='production'){return new SignJWT({tenant,environment,nonce:crypto.randomUUID()}).setProtectedHeader({alg:'HS256'}).setIssuer('jobyard').setAudience('quickbooks-oauth').setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(key));}
Deno.test('80 independent domains route only to their own approved callbacks',async()=>{
 const handler=createProductionRouter(routes);
 for(const [tenant,route]of Object.entries(routes)){const signed=await state(tenant,route.key);const r=await handler(new Request('https://router.example.com?'+new URLSearchParams({state:signed,code:'synthetic',realmId:'999999999999',return_url:'https://attacker.example'})));assert(r.status===302);const target=new URL(r.headers.get('Location')!);assert(target.origin===new URL(route.callback).origin);assert(target.pathname===new URL(route.callback).pathname);assert(!target.searchParams.has('return_url'));assert(await r.text()==='');assert(r.headers.get('Referrer-Policy')==='no-referrer');}
});
Deno.test('A different tenant key or sandbox state cannot authorize production routing',async()=>{
 const handler=createProductionRouter(routes);
 for(const signed of [await state('company_0',routes.company_1.key),await state('company_0',routes.company_0.key,'sandbox'),await state('unregistered',routes.company_0.key),'bad'])assert((await handler(new Request('https://router.example.com?'+new URLSearchParams({state:signed,error:'access_denied'})))).status===400);
});
Deno.test('Unsafe callbacks and shared installation keys are rejected',()=>{
 for(const bad of ['http://company.example.com/callback','https://user:pass@company.example.com/callback','https://company.example.com/callback#fragment','https://company.example.com/callback?next=other']){let rejected=false;try{createProductionRouter({company:{key:routes.company_0.key,callback:bad}});}catch{rejected=true;}assert(rejected);}
 let rejected=false;try{createProductionRouter({one:routes.company_0,two:routes.company_0});}catch{rejected=true;}assert(rejected);
});
Deno.test('Mixed-company notification batches are separated and identifiers are tenant-specific',async()=>{
 const payload={eventNotifications:Array.from({length:80},(_,i)=>({realmId:String(9999900000+i),dataChangeEvent:{entities:[{id:'42',name:'Invoice',operation:'Update',lastUpdated:'2026-10-19T18:00:00Z'}]}}))};
 const keys=new Set<string>();for(const notification of payload.eventNotifications){const rows=await quickBooksEventRows(payload,notification.realmId);assert(rows.length===1);assert(rows[0].realm_id===notification.realmId);assert(!('eventNotifications' in rows[0].payload));keys.add(rows[0].event_key);}assert(keys.size===80);
});
Deno.test('Empty production registry, duplicate state and non-GET fail closed',async()=>{
 const handler=createProductionRouter(routes),signed=await state('company_0',routes.company_0.key);
 assert((await createProductionRouter({})(new Request('https://router.example.com?'+new URLSearchParams({state:signed,error:'access_denied'})))).status===400);
 assert((await handler(new Request('https://router.example.com?'+new URLSearchParams({state:signed,error:'access_denied'})+'&state=other'))).status===400);
 assert((await handler(new Request('https://router.example.com',{method:'POST'}))).status===405);
});
