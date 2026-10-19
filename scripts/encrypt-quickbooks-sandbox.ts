import { QuickBooksVault } from '../supabase/functions/_shared/quickbooks-vault.ts';
const config = Object.fromEntries((await Deno.readTextFile('supabase/functions/.env.sandbox-runtime.local')).trim().split('\n').map(line=>{const pos=line.indexOf('=');return [line.slice(0,pos),(line.slice(pos+1).startsWith("'")?line.slice(pos+2,-1):JSON.parse(line.slice(pos+1)))];}));
if(config.APP_ENV!=='sandbox'||config.QB_ENVIRONMENT!=='sandbox')throw new Error('Sandbox only.');
const vault=new QuickBooksVault(JSON.parse(config.QB_TOKEN_KEYS),config.QB_TOKEN_KEY_ID,config.QB_INSTALLATION_ID);
const db=async(sql:string)=>{
  const child=new Deno.Command('docker',{args:['exec','-i','supabase_db_miller-sawdust','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],stdin:'piped',stdout:'piped',stderr:'piped'}).spawn();
  const input=child.stdin.getWriter();await input.write(new TextEncoder().encode(sql));await input.close();
  const result=await child.output();if(!result.success)throw new Error('Local sandbox SQL failed.');return new TextDecoder().decode(result.stdout).trim();
};
const rows=JSON.parse(await db("select coalesce(json_agg(t),'[]') from qb_tokens t;"));
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
for(const row of rows){
  const values:Record<string,string>={};
  for(const name of ['realm_id','access_token','refresh_token']) {
    values[name]=row[name].startsWith('jv1.')?row[name]:await vault.seal(row[name],name);
    if(await vault.open(values[name],name)!==(row[name].startsWith('jv1.')?await vault.open(row[name],name):row[name]))throw new Error('Encryption verification failed.');
  }
  await db('update qb_tokens set '+Object.entries(values).map(([k,v])=>k+'='+quote(v)).join(',')+' where id='+quote(row.id)+';');
}
console.log('Encrypted and verified '+rows.length+' local sandbox connection(s). No credentials printed.');
