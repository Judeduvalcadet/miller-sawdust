import {createClient} from 'npm:@supabase/supabase-js@2.49.0';
import {quickBooksEventRows,verifyQuickBooksSignature} from '../../../../supabase/functions/_shared/quickbooks-webhook.ts';

// Hard boundary: this function cannot initialize in Miller or Trail production.
const project='csrvvapbaicedypoonzs';
const environment=Deno.env.get('APP_ENV');
const url=Deno.env.get('SUPABASE_URL')||'';
if(environment!=='quickbooks_gateway_sandbox'||new URL(url).hostname!==project+'.supabase.co')throw new Error('Gateway refused a different project or environment.');
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const checked=(r:{data:any,error:any})=>{if(r.error)throw new Error(r.error.message);return r.data;};
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
  if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
  try{
    const raw=await req.text();if(raw.length>1024*1024)return reply(413,{error:'payload_too_large'});
    if(new URL(req.url).searchParams.get('action')==='webhook'){
      if(!await verifyQuickBooksSignature(raw,req.headers.get('intuit-signature')||'',Deno.env.get('QB_WEBHOOK_VERIFIER_TOKEN')||''))return reply(401,{error:'invalid_signature'});
      let rows;
      try{
        const payload=JSON.parse(raw);
        if(!Array.isArray(payload.eventNotifications))throw new Error('Missing notifications.');
        const realms=[...new Set(payload.eventNotifications.map((n:any)=>String(n.realmId||'')))];
        if(realms.some(r=>!r))throw new Error('Missing company.');
        rows=(await Promise.all(realms.map(realm=>quickBooksEventRows(payload,realm as string)))).flat();
      }catch{return reply(400,{error:'invalid_payload'});}
      if(rows.length)checked(await db.from('qb_gateway_events').upsert(rows,{onConflict:'event_key',ignoreDuplicates:true}));
      return reply(200,{received:rows.length});
    }
    const key=req.headers.get('x-jobyard-relay-key');if(!key)return reply(403,{error:'unauthorized'});
    const client=checked(await db.from('qb_gateway_clients').select('realm_id').eq('key_sha256',await hash(key)).eq('enabled',true).maybeSingle());
    if(!client)return reply(403,{error:'unauthorized'});
    const body=JSON.parse(raw);
    if(body.realm_id!==client.realm_id)return reply(403,{error:'company_mismatch'});
    if(body.action==='pull'){
      const events=checked(await db.from('qb_gateway_events').select('event_key,realm_id,entity_name,entity_id,operation,source_updated_at,payload,received_at').eq('realm_id',client.realm_id).is('delivered_at',null).order('received_at').limit(30));
      return reply(200,{events});
    }
    if(body.action==='ack'){
      if(!Array.isArray(body.keys)||body.keys.length>100)return reply(400,{error:'invalid_ack'});
      if(body.keys.length)checked(await db.from('qb_gateway_events').update({delivered_at:new Date().toISOString()}).eq('realm_id',client.realm_id).in('event_key',body.keys));
      return reply(200,{acknowledged:true});
    }
    return reply(400,{error:'unknown_action'});
  }catch{return reply(503,{error:'gateway_unavailable'});}
});
