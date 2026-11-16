import { assertLocalSandboxDatabase } from './environment.ts';

type Environment = Record<string, string | undefined>;
export function quickBooksRuntime(env: Environment) {
  if (env.APP_ENV === 'sandbox' && env.QB_ENVIRONMENT === 'sandbox') {
    assertLocalSandboxDatabase(env.SUPABASE_URL || '');
    return { environment: 'sandbox', apiBase: 'https://sandbox-quickbooks.api.intuit.com', gateway: 'https://csrvvapbaicedypoonzs.supabase.co/functions/v1/qb-relay' };
  }
  const database = new URL(env.SUPABASE_URL || 'https://invalid');
  if (env.APP_ENV !== 'production' || env.QB_ENVIRONMENT !== 'production' || env.QB_PRODUCTION_SYNC_ENABLED !== 'true' ||
      database.protocol !== 'https:' || !/^[a-z]{20}\.supabase\.co$/.test(database.hostname) || database.username || database.password || database.search || database.hash || database.pathname !== '/') {
    throw new Error('QuickBooks is not enabled for this server environment.');
  }
  return { environment: 'production', apiBase: 'https://quickbooks.api.intuit.com', gateway: 'https://hvryrivqjqsxfcypvqie.supabase.co/functions/v1/qb-relay' };
}
