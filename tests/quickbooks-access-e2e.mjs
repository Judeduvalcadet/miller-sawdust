import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const env=parseEnv(await readFile('.env.sandbox.local','utf8'));
assert.equal(env.VITE_SUPABASE_URL,'http://127.0.0.1:54521');
const sql=input=>{const r=spawnSync('docker',['exec','-i','supabase_db_miller-sawdust','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],{input,encoding:'utf8'});if(r.status)throw Error('Local sandbox SQL failed');return r.stdout.trim();};
const login=await fetch(env.VITE_SUPABASE_URL+'/functions/v1/login',{method:'POST',headers:{'Content-Type':'application/json',apikey:env.VITE_SUPABASE_ANON_KEY},body:await readFile('.env.office-sandbox.local','utf8')});
assert.equal(login.status,200);const session=await login.json();
const id=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url')).sub;assert.match(id,/^[a-f0-9-]{36}$/i);
const original=JSON.parse(sql(`select row_to_json(q) from (select active,role from drivers where id='${id}') q;`));
assert.ok(['admin','assistant'].includes(original.role));assert.equal(original.active,true);
const results=[];
async function request(fn,action){const r=await fetch(env.VITE_SUPABASE_URL+'/functions/v1/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action})});return r.status;}
try {
 for(const [name,change] of [['Deactivated office user cannot reuse an existing JWT',"active=false"],['Demoted office user cannot reuse an existing JWT',"active=true,role='driver'"]]){
  sql(`update drivers set ${change} where id='${id}';`);
  assert.ok([401,403].includes(await request('qb-auth','status')));assert.ok([401,403].includes(await request('qb-sync','status')));
  results.push({name,status:'passed'});console.log('PASS',name);
 }
} finally {sql(`update drivers set active=true,role='${original.role}' where id='${id}';`);}
assert.equal(await request('qb-auth','status'),200);assert.equal(await request('qb-sync','status'),200);
results.push({name:'Restored office account regains authorized access',status:'passed'});
assert.equal(await readFile('supabase/functions/_shared/quickbooks-oauth.ts','utf8'),await readFile('sandbox-gateway/supabase/functions/_shared/quickbooks-oauth.ts','utf8'));
results.push({name:'Hosted and local OAuth validation helper copies match',status:'passed'});
await writeFile('output/quickbooks-tests/current-account-access.json',JSON.stringify({environment:'sandbox',results},null,2));
console.log(JSON.stringify({passed:results.length,failed:0}));
