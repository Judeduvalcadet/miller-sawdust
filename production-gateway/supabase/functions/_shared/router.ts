import { decodeJwt } from 'npm:jose@5.10.0';
import { verifiedState, safeCallback, redirect, oauthHeaders } from './quickbooks-oauth.ts';
export type Routes = Record<string,{callback:string;key:string}>;
export function createProductionRouter(routes:Routes) {
  const keys=new Set<string>();
  for(const [tenant,route] of Object.entries(routes)) {
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(tenant)||route.key.length<32||keys.has(route.key))throw Error('Every installation requires a unique state key.');
    keys.add(route.key);
    const callback=safeCallback(route.callback,false);
    if(callback.search)throw Error('Registered callbacks cannot include a query.');
  }
  return async(req:Request)=>{
    const invalid=(status:number)=>new Response('Connection expired or unavailable. Start again from your company software.',{status,headers:{...oauthHeaders,'Content-Type':'text/plain; charset=utf-8'}});
    if(req.method!=='GET')return invalid(405);
    try {
      const incoming=new URL(req.url),state=incoming.searchParams.get('state')||'';
      if(state.length>4096)return invalid(400);
      // Untrusted decode selects a key; verification must succeed before routing.
      const tenant=String(decodeJwt(state).tenant||'');
      if(!Object.hasOwn(routes,tenant))return invalid(400);
      const route=routes[tenant];
      await verifiedState(state,route.key,tenant,'production');
      const target=safeCallback(route.callback,false);target.search='';
      for(const field of ['state','code','realmId','error']) {
        const values=incoming.searchParams.getAll(field);
        if(values.length>1||(values[0]?.length||0)>4096)return invalid(400);
        if(values.length)target.searchParams.set(field,values[0]);
      }
      if(!incoming.searchParams.has('code')&&!incoming.searchParams.has('error'))return invalid(400);
      return redirect(target.toString());
    } catch {return invalid(400);}
  };
}
