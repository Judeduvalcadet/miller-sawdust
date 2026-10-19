import {assertLocalSandboxDatabase} from '../supabase/functions/_shared/environment.ts';
function rejects(value:string){let rejected=false;try{assertLocalSandboxDatabase(value);}catch{rejected=true;}if(!rejected)throw Error('Unsafe sandbox URL accepted');}
Deno.test('Independent local project names work without hard-coding a client company',()=>{
 for(const url of ['http://kong:8000','http://supabase_kong_miller-sawdust:8000','http://supabase_kong_jobyard-company-b:8000','http://localhost:54621','http://127.0.0.1:54521'])assertLocalSandboxDatabase(url);
});
Deno.test('Neither hosted production nor hosted sandbox databases can be substituted',()=>{
 for(const url of ['https://mwunopdpquixccfdxpei.supabase.co','https://csrvvapbaicedypoonzs.supabase.co','https://hvryrivqjqsxfcypvqie.supabase.co'])rejects(url);
});
Deno.test('Lookalike local hostnames and credentials cannot bypass sandbox isolation',()=>{
 for(const url of ['http://localhost.attacker.example.com','http://supabase_kong_company.attacker.example.com','http://localhost@attacker.example.com','http://user:password@localhost:54521'])rejects(url);
});
Deno.test('Unexpected URL protocols, paths, fragments and query strings fail closed',()=>{
 for(const url of ['ftp://localhost','http://localhost/private','http://localhost?next=production','http://localhost#production',''])rejects(url);
});
