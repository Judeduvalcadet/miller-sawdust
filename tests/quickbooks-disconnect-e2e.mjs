import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {decodeTestConnection} from './quickbooks-private.mjs';
import assert from 'node:assert/strict';
const env=parseEnv(await readFile('supabase/functions/.env.sandbox-runtime.local','utf8'));assert.equal(env.APP_ENV,'sandbox');assert.equal(env.QB_ENVIRONMENT,'sandbox');
const read=()=>{const p=spawnSync('docker',['exec','supabase_db_miller-sawdust','psql','-X','-U','postgres','-d','postgres','-Atc',"select coalesce(json_agg(t),'[]') from qb_tokens t"],{encoding:'utf8'});if(p.status)throw Error('Local DB unavailable');return JSON.parse(p.stdout);};
const before=decodeTestConnection(read()[0]);
console.log('Ready for the sandbox Disconnect confirmation.');
let disconnected=false;
for(let i=0;i<90;i++){if(read().length===0){disconnected=true;break;}await delay(500);}
assert.equal(disconnected,true,'Sandbox disconnect was not completed.');
const refresh=await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.QB_CLIENT_ID+':'+env.QB_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:before.refresh_token}),signal:AbortSignal.timeout(12000)});
const body=await refresh.json();assert.ok(!refresh.ok&&!body.access_token,'Disconnected grant still renewed tokens.');
console.log('PASS Sandbox disconnect deleted the encrypted local connection and Intuit refused the revoked refresh token.');
await writeFile('output/quickbooks-tests/disconnect-security.json',JSON.stringify({environment:'sandbox',results:[{name:'Real sandbox disconnect revokes the Intuit grant and removes stored credentials',status:'passed'}]},null,2));
