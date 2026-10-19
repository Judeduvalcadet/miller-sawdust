import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/entities';

export default function QuickBooksBadge({record,entity='invoices'}) {
  const [working,setWorking]=useState(false);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState('');
  const cache=useQueryClient();
  const state=record.qb_sync_status || 'unlinked';
  const label=state==='synced'?'Synced to QuickBooks':state==='pending'?'QuickBooks sync pending':state==='error'?'QuickBooks sync needs attention':'Not synced to QuickBooks';
  const run=async resolution=>{
    setWorking(true);setError('');
    try{await base44.functions.invoke('qb-sync',{action:'retry',entity,id:record.id,resolution});await cache.invalidateQueries();setOpen(false);}
    catch(e){setError(e.message||'Could not retry synchronization.');}
    finally{setWorking(false);}
  };
  return <span className="relative inline-flex align-middle">
    <button type="button" aria-label={label} title={`${label}${record.qb_sync_error?': '+record.qb_sync_error:''}`}
      onClick={e=>{e.stopPropagation();setOpen(!open);}} className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[9px] font-bold ${state==='synced'?'bg-green-50 text-green-700 border-green-300':state==='error'?'bg-red-50 text-red-700 border-red-300':state==='pending'?'bg-amber-50 text-amber-700 border-amber-300':'bg-gray-50 text-gray-400 border-gray-200'}`}>QB{state==='synced'?' ✓':state==='pending'?' ·':''}</button>
    {open&&<span role="dialog" aria-label="QuickBooks sync details" className="absolute right-0 top-7 z-50 w-72 rounded-lg border bg-white p-3 text-xs font-normal text-gray-700 shadow-lg" onClick={e=>e.stopPropagation()}>
      <strong className="block mb-1">{label}</strong>
      {record.qb_sync_error&&<span className="block mb-2 break-words">{record.qb_sync_error}</span>}
      {error&&<span role="alert" className="block text-red-600">{error}</span>}
      {state!=='synced'&&<button disabled={working} className="mr-3 underline" onClick={()=>run()}>Retry</button>}
      {state==='error'&&record.qb_id&&<><button disabled={working} className="mr-3 underline" onClick={()=>run('quickbooks')}>Use QuickBooks version</button><button disabled={working} className="mr-3 underline" onClick={()=>run('software')}>Use software version</button></>}
      <button className="underline" onClick={()=>setOpen(false)}>Close</button>
    </span>}
  </span>;
}
