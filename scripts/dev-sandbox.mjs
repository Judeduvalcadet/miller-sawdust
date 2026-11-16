// Start the local preview only after its Edge Functions gateway is ready.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareSandboxEnv } from './sandbox-env.mjs';

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
async function ready() {
  try {
    const response = await fetch('http://127.0.0.1:54521/functions/v1/messaging', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }), signal: AbortSignal.timeout(3000),
    });
    // The handler must be reachable and enforcing office authentication.
    const body = await response.json();
    return response.status === 403 && body.error === 'Office email/password sign-in required.';
  } catch { return false; }
}
try {
  const envFile = await prepareSandboxEnv();
  if (!await ready()) {
    console.log('Starting sandbox Edge Functions…');
    const functions = spawn('supabase', ['functions', 'serve', '--env-file', envFile], { stdio: 'inherit' });
    children.push(functions);
    functions.on('error', () => { console.error('Could not start Supabase CLI.'); stop(1); });
    functions.on('exit', () => { if (!stopping) { console.error('Sandbox Edge Functions stopped.'); stop(1); } });
    let available = false;
    for (let attempt = 0; attempt < 45 && !stopping; attempt++) {
      if (await ready()) { available = true; break; }
      await delay(1000);
    }
    if (!available && !stopping) throw new Error('Local messaging did not become ready. Check Docker and start the local Supabase stack.');
  }
  if (!stopping) {
    const qbWorker=spawn(process.execPath,['scripts/quickbooks-worker.mjs'],{stdio:'inherit'});
    children.push(qbWorker);
    console.log('Sandbox messaging is ready. Starting preview on port 5174.');
    const vite = spawn('npm', ['run', 'dev', '--', '--mode', 'sandbox', '--port', '5174', '--strictPort', '--host', '127.0.0.1'], { stdio: 'inherit' });
    children.push(vite);
    vite.on('error', () => stop(1));
    vite.on('exit', code => stop(code ?? 1));
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
