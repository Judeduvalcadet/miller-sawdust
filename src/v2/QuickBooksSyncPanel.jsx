import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/entities';
import { Button } from '@/components/ui/button';

export default function QuickBooksSyncPanel({ sandbox = import.meta.env.MODE === 'sandbox' }) {
  const cache=useQueryClient(),[working,setWorking]=useState(false),[error,setError]=useState('');
  const {data,status}=useQuery({queryKey:['qb-sync-health'],queryFn:async()=>(await base44.functions.invoke('qb-sync',{action:'status'})).data,refetchInterval:10000});
  const run=async action=>{
    setWorking(true);setError('');
    try{await base44.functions.invoke('qb-sync',{action});await cache.invalidateQueries();}
    catch(e){setError(e.message||'Synchronization is unavailable. Queued changes are retained.');}
    finally{setWorking(false);}
  };
  return <section className="mt-4 rounded-2xl border bg-white p-5 text-sm">
    <h3 className="font-semibold">{sandbox ? 'Sandbox synchronization' : 'QuickBooks synchronization'}</h3>
    <a className="float-right underline text-gray-600" href="mailto:support@myjobyard.com">Contact JobYard support</a>
    <p className="mt-1 text-gray-500">{sandbox ? 'Changes use the QuickBooks test company. The local background worker delivers queued changes and processes notifications.' : 'Changes sync with your connected QuickBooks company. Pending changes are retained if QuickBooks is temporarily unavailable.'}</p>
    {data&&<p className="my-3" role="status">{data.pending} pending changes · {data.errors} needing attention · {data.notifications} notifications waiting{data.reconciling?' · Checking QuickBooks for missed updates…':''}</p>}
    {data?.gatewayError&&<p role="alert" className="my-3 text-amber-700">Incoming notifications: {data.gatewayError}</p>}
    {status==='error'&&<p role="alert" className="my-3 text-red-600">Could not read synchronization status.</p>}
    {error&&<p role="alert" className="my-3 text-red-600">{error}</p>}
    <div className="mt-3 flex gap-2"><Button variant="outline" disabled={working} onClick={()=>run('run')}>Sync now</Button><Button variant="outline" disabled={working||data?.reconciling} onClick={()=>run('reconcile')}>Check for missed updates</Button></div>
    {data?.reconciledAt&&<p className="mt-2 text-xs text-gray-500">Last scan: {new Date(data.reconciledAt).toLocaleString()}. Notifications may still be processing.</p>}
  </section>;
}
