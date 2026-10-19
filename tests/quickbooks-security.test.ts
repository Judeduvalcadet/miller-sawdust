import { QuickBooksVault } from '../supabase/functions/_shared/quickbooks-vault.ts';
import { verifiedState, safeCallback, redirect } from '../supabase/functions/_shared/quickbooks-oauth.ts';
import { SignJWT } from 'npm:jose@5.10.0';
const assert=(v:unknown)=>{if(!v)throw new Error('Assertion failed');};
const rejected=async(f:()=>unknown)=>{try{await f();}catch{return;}throw new Error('Expected rejection');};
const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
Deno.test('AES-GCM protects tokens and realm ID; random IV prevents matching ciphertext',async()=>{
 const vault=new QuickBooksVault({k1:key},'k1','company-a');
 for(const column of ['realm_id','access_token','refresh_token']){
  const sealed=await vault.seal('test-private-value',column);
  assert(!sealed.includes('test-private-value'));assert(await vault.open(sealed,column)==='test-private-value');assert(sealed!==await vault.seal('test-private-value',column));
 }
});
Deno.test('Changed ciphertext, wrong column/company/key, and plaintext are refused',async()=>{
 const vault=new QuickBooksVault({k1:key},'k1','company-a'),sealed=await vault.seal('private','refresh_token');
 await rejected(()=>vault.open('plaintext','refresh_token'));
 await rejected(()=>vault.open(sealed,'access_token'));
 await rejected(()=>new QuickBooksVault({k1:key},'k1','company-b').open(sealed,'refresh_token'));
 await rejected(()=>new QuickBooksVault({k1:btoa('x'.repeat(32))},'k1','company-a').open(sealed,'refresh_token'));
 const parts=sealed.split('.');const raw=Uint8Array.from(atob(parts[3]),c=>c.charCodeAt(0));raw[0]^=1;parts[3]=btoa(String.fromCharCode(...raw));await rejected(()=>vault.open(parts.join('.'),'refresh_token'));
});
Deno.test('Key rotation reads old envelopes and writes with the new key',async()=>{
 const old=new QuickBooksVault({old:key},'old','a');const sealed=await old.seal('private','realm_id');
 const rotating=new QuickBooksVault({old:key,new:btoa('y'.repeat(32))},'new','a');assert(await rotating.open(sealed,'realm_id')==='private');assert((await rotating.seal('private','realm_id')).startsWith('jv1.new.'));
});
Deno.test('OAuth state rejects another company, environment, signature, expiry and audience',async()=>{
 const signing='s'.repeat(64);
 const issue=(patch:Record<string,unknown>={})=>new SignJWT({nonce:crypto.randomUUID(),tenant:'a',environment:'sandbox',iss:'jobyard',aud:'quickbooks-oauth',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,...patch}).setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode(signing));
 const state=await issue();assert((await verifiedState(state,signing,'a','sandbox')).tenant==='a');
 await rejected(()=>verifiedState(state,signing,'b','sandbox'));await rejected(()=>verifiedState(state,signing,'a','production'));await rejected(()=>verifiedState(state,'z'.repeat(64),'a','sandbox'));
 for(const patch of [{exp:1},{aud:'other'},{iss:'other'},{nonce:null}])await rejected(async()=>verifiedState(await issue(patch),signing,'a','sandbox'));
});
Deno.test('Server callback returns empty 302 with no-store/referrer protection',()=>{
 const response=redirect('https://company.example/return');assert(response.status===302);assert(response.body===null);assert(response.headers.get('Cache-Control')?.includes('no-store'));assert(response.headers.get('Referrer-Policy')==='no-referrer');assert(!response.headers.has('Content-Type'));
});
Deno.test('Only HTTPS destinations or explicit sandbox loopback are accepted',async()=>{
 assert(safeCallback('https://company.example/callback',false).hostname==='company.example');assert(safeCallback('http://localhost:54521/callback',true).hostname==='localhost');
 for(const url of ['http://company.example','javascript:alert(1)','https://user:password@company.example','https://company.example/#code'])await rejected(()=>safeCallback(url,false));
});
