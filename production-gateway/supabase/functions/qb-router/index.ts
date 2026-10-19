import {createProductionRouter} from '../_shared/router.ts';
// Explicit separate infrastructure boundary. No tokens or customer database access.
if(Deno.env.get('APP_ENV')!=='quickbooks_gateway_production'||new URL(Deno.env.get('SUPABASE_URL')||'').hostname!=='hvryrivqjqsxfcypvqie.supabase.co')throw Error('Router refused a different project or environment.');
Deno.serve(createProductionRouter(JSON.parse(Deno.env.get('QB_ROUTER_ROUTES')||'{}')));
