import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedSandboxValues } from '../scripts/sandbox-env.mjs';

test('sandbox overrides live send flags and removes live provider/database credentials', () => {
  const result = isolatedSandboxValues({ QB_ENVIRONMENT: 'production', APP_ENV: 'production',
    INVOICE_SEND_DRY_RUN: 'false', MESSAGING_SEND_ENABLED: 'true', RESEND_API_KEY: 'live',
    TWILIO_AUTH_TOKEN: 'live', RESEND_RELAY_WEBHOOK_SECRET: 'live', SUPABASE_URL: 'https://production.example', SUPABASE_SERVICE_ROLE_KEY: 'live',
  }, { QB_CLIENT_ID: 'development', QB_ENVIRONMENT: 'production', SUPABASE_URL: 'https://another.example' });
  assert.equal(result.APP_ENV, 'sandbox');
  assert.equal(result.QB_ENVIRONMENT, 'sandbox');
  assert.equal(result.QB_CLIENT_ID, 'development');
  assert.equal(result.INVOICE_SEND_DRY_RUN, 'true');
  assert.equal(result.MESSAGING_SEND_ENABLED, 'false');
  for (const key of ['RESEND_API_KEY', 'RESEND_RELAY_WEBHOOK_SECRET', 'TWILIO_AUTH_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) assert.equal(result[key], undefined);
  assert.equal(isolatedSandboxValues({ QB_CLIENT_SECRET: 'production-secret' }, {}).QB_CLIENT_SECRET, undefined);
});
test('sandbox refuses a callback to a deployed website', () => {
  assert.throws(() => isolatedSandboxValues({}, { QB_REDIRECT_URI: 'https://production.example/QBCallback' }), /local server/);
});
test('sandbox refuses notification routing to any other hosted project', () => {
  assert.throws(() => isolatedSandboxValues({}, { QB_SANDBOX_GATEWAY_URL: 'https://production.example/functions/v1/qb-relay' }), /isolated test project/);
});
