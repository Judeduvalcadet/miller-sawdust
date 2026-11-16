import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const file='supabase/functions/.env.sandbox-runtime.local';
let lastError='',lastRelayError='';
while(true){
  try{
    const env=parseEnv(await readFile(file,'utf8'));
    if(env.APP_ENV!=='sandbox'||env.QB_ENVIRONMENT!=='sandbox')throw new Error('Worker refused a non-sandbox configuration.');
    const response=await fetch('http://127.0.0.1:54521/functions/v1/qb-sync',{
      method:'POST',headers:{'Content-Type':'application/json','x-qb-worker-key':env.QB_SYNC_WORKER_SECRET},body:JSON.stringify({action:'run'}),signal:AbortSignal.timeout(55000),
    });
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||'Local worker unavailable.');
    if(body.pushed||body.pulled||body.errors)console.log('QuickBooks sandbox:',JSON.stringify(body));
    if(body.relayError&&body.relayError!==lastRelayError)console.error('QuickBooks incoming notifications:',body.relayError);
    lastRelayError=body.relayError||'';
    lastError='';
  }catch(error){if(error.message!==lastError)console.error('QuickBooks sandbox:',error.message);lastError=error.message;}
  await delay(2000);
}
