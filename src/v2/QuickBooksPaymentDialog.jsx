import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/entities';
import { assertV2Writable } from './guard';

export default function QuickBooksPaymentDialog({invoice,onClose}) {
  const [amount,setAmount]=useState(String(invoice.balance||''));
  const [working,setWorking]=useState(false),[error,setError]=useState('');
  const key=useRef(crypto.randomUUID()),cache=useQueryClient();
  const save=async()=>{
    setWorking(true);setError('');
    try{assertV2Writable();await base44.functions.invoke('qb-sync',{action:'record-payment',id:invoice.id,amount:Number(amount),request_id:key.current});await cache.invalidateQueries();onClose();}
    catch(e){setError(e.message||'Payment could not be recorded. Retrying uses the same request to prevent duplicates.');}
    finally{setWorking(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!working)onClose();}}><DialogContent>
    <DialogHeader><DialogTitle>Record payment for invoice #{invoice.doc_number}</DialogTitle></DialogHeader>
    <p className="text-sm text-gray-600">Balance: ${Number(invoice.balance||0).toFixed(2)}. This records a payment in QuickBooks; it does not charge a card or move money.</p>
    <label className="text-sm">Payment amount<Input aria-label="Payment amount" type="number" min="0.01" step="0.01" value={amount} disabled={working} onChange={e=>{setAmount(e.target.value);key.current=crypto.randomUUID();}} /></label>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={working} onClick={onClose}>Cancel</Button><Button disabled={working||!Number.isFinite(Number(amount))||Number(amount)<=0||Number(amount)>Number(invoice.balance)} onClick={save}>{working?'Recording…':'Record payment'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
