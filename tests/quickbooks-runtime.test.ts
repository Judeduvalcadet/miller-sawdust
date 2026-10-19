import { quickBooksRuntime } from '../supabase/functions/_shared/quickbooks-runtime.ts';
const local = { APP_ENV:'sandbox', QB_ENVIRONMENT:'sandbox', SUPABASE_URL:'http://127.0.0.1:54521' };
const live = { APP_ENV:'production', QB_ENVIRONMENT:'production', QB_PRODUCTION_SYNC_ENABLED:'true', SUPABASE_URL:'https://mwunopdpquixccfdxpei.supabase.co' };
function assert(value:boolean){if(!value)throw Error('Runtime boundary assertion failed');}
function rejected(env:Record<string,string|undefined>){let failed=false;try{quickBooksRuntime(env);}catch{failed=true;}assert(failed);}
Deno.test('QuickBooks sandbox cannot reach a hosted database or production API',()=>{
  assert(quickBooksRuntime(local).apiBase==='https://sandbox-quickbooks.api.intuit.com');
  rejected({...local,SUPABASE_URL:live.SUPABASE_URL});
  rejected({...local,QB_ENVIRONMENT:'production'});
});
Deno.test('QuickBooks production needs explicit server opt-in and a hosted database',()=>{
  assert(quickBooksRuntime(live).apiBase==='https://quickbooks.api.intuit.com');
  for(const patch of [{QB_PRODUCTION_SYNC_ENABLED:undefined},{QB_PRODUCTION_SYNC_ENABLED:'false'},{APP_ENV:undefined},{QB_ENVIRONMENT:'sandbox'},{SUPABASE_URL:local.SUPABASE_URL},{SUPABASE_URL:'https://mwunopdpquixccfdxpei.supabase.co.attacker.example'},{SUPABASE_URL:'https://secret@mwunopdpquixccfdxpei.supabase.co'}])rejected({...live,...patch});
});
Deno.test('Production installations share routing infrastructure without a shared company database',()=>{
  const other=quickBooksRuntime({...live,SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co'});
  assert(other.gateway===quickBooksRuntime(live).gateway);
  assert(other.gateway!==quickBooksRuntime(local).gateway);
});
