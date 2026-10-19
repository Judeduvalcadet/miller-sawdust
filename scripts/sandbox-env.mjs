import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';

export function isolatedSandboxValues(base, qb) {
  // Only QuickBooks development inputs may enter from its private file.
  const quickbooks = Object.fromEntries(Object.entries(qb).filter(([key]) =>
    ['QB_CLIENT_ID', 'QB_CLIENT_SECRET', 'QB_REDIRECT_URI', 'QB_WEBHOOK_VERIFIER_TOKEN', 'QB_SANDBOX_GATEWAY_URL', 'QB_SANDBOX_GATEWAY_KEY', 'QB_COMPLETION_URI', 'QB_INSTALLATION_ID', 'QB_OAUTH_STATE_SECRET', 'QB_TOKEN_KEYS', 'QB_TOKEN_KEY_ID'].includes(key)));
  if (quickbooks.QB_REDIRECT_URI && !['http://127.0.0.1:54521/functions/v1/qb-oauth-return', 'https://csrvvapbaicedypoonzs.supabase.co/functions/v1/qb-router'].includes(quickbooks.QB_REDIRECT_URI)) {
    throw new Error('Sandbox QuickBooks callback must use the local server or isolated shared router.');
  }
  if(quickbooks.QB_SANDBOX_GATEWAY_URL && quickbooks.QB_SANDBOX_GATEWAY_URL!=='https://csrvvapbaicedypoonzs.supabase.co/functions/v1/qb-relay')throw new Error('Sandbox notification gateway must use the isolated test project.');
  const safeBase = Object.fromEntries(Object.entries(base).filter(([key]) => !key.startsWith('QB_')));
  const values = { ...safeBase, ...quickbooks, APP_ENV: 'sandbox', QB_ENVIRONMENT: 'sandbox',
    INVOICE_SEND_DRY_RUN: 'true', MESSAGING_SEND_ENABLED: 'false', MESSAGING_WRITES_ENABLED: 'true' };
  // The local runtime injects its own database keys; never override them from files.
  for (const key of Object.keys(values)) {
    if (key.startsWith('SUPABASE_') || key.startsWith('TWILIO_') ||
        ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'RESEND_RELAY_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY'].includes(key)) delete values[key];
  }
  return values;
}

// Keep the developer's private inputs separate from the generated runtime file.
export async function prepareSandboxEnv() {
  const frontend = parseEnv(await readFile('.env.sandbox.local', 'utf8'));
  if (frontend.VITE_SUPABASE_URL !== 'http://127.0.0.1:54521') {
    throw new Error('Sandbox must use the local database on port 54521.');
  }
  const base = parseEnv(await readFile('supabase/functions/.env', 'utf8'));
  let qb = {};
  try { qb = parseEnv(await readFile('supabase/functions/.env.quickbooks.local', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try{Object.assign(qb,parseEnv(await readFile('supabase/functions/.env.qb-gateway.local','utf8')));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  // Private per-installation encryption and state keys persist across restarts.
  const vaultPath='supabase/functions/.env.qb-vault.local';
  let privateConfig;
  try { privateConfig=JSON.parse(await readFile(vaultPath,'utf8')); }
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    privateConfig={QB_INSTALLATION_ID:'miller-local-sandbox',QB_TOKEN_KEY_ID:'sandbox1',QB_TOKEN_KEYS:JSON.stringify({sandbox1:randomBytes(32).toString('base64')}),QB_OAUTH_STATE_SECRET:randomBytes(32).toString('hex'),QB_COMPLETION_URI:'http://localhost:5174/QBCallback',QB_REDIRECT_URI:'https://csrvvapbaicedypoonzs.supabase.co/functions/v1/qb-router'};
    await writeFile(vaultPath,JSON.stringify(privateConfig),{mode:0o600});
  }
  Object.assign(qb,privateConfig);
  const values = isolatedSandboxValues(base, qb);
  // Preserve a private worker credential across sandbox restarts.
  const secretPath='supabase/functions/.env.qb-worker.local';
  try { values.QB_SYNC_WORKER_SECRET=(await readFile(secretPath,'utf8')).trim(); }
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    values.QB_SYNC_WORKER_SECRET=randomBytes(32).toString('hex');
    await writeFile(secretPath,values.QB_SYNC_WORKER_SECRET,{mode:0o600});
  }
  const path = 'supabase/functions/.env.sandbox-runtime.local';
  await writeFile(path, Object.entries(values).map(([key, value]) => `${key}=${key==='QB_TOKEN_KEYS'?"'"+value+"'":JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
