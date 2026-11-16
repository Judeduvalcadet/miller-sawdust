import { quickBooksOffice } from '../_shared/quickbooks-access.ts';
import { service,json,handleOptions,verifyAccessToken } from '../_shared/mod.ts';
import { QuickBooksSync } from '../_shared/quickbooks-sync.ts';

Deno.serve(async req=>{
  const opts=handleOptions(req);if(opts)return opts;
  if(req.method!=='POST')return json(405,{error:'method_not_allowed'});
  const worker=Deno.env.get('QB_SYNC_WORKER_SECRET');
  const workerAuthorized=!!worker&&req.headers.get('x-qb-worker-key')===worker;
  const claims=workerAuthorized?null:await quickBooksOffice(req);
  if(!workerAuthorized&&(!claims||!['admin','assistant'].includes(String(claims.app_role))||claims.amr!=='password'))return json(403,{error:'Office password sign-in required.'});
  try{
    const qb=await QuickBooksSync.open();const body=await req.json().catch(()=>({}));
    if(body.action==='status'){
      const counts=await Promise.all([service.from('qb_sync_jobs').select('*',{count:'exact',head:true}).eq('realm_id',qb.connection.realm_id).eq('state','pending'),service.from('qb_sync_jobs').select('*',{count:'exact',head:true}).eq('realm_id',qb.connection.realm_id).eq('state','error'),service.from('qb_webhook_events').select('*',{count:'exact',head:true}).eq('realm_id',qb.connection.realm_id).is('processed_at',null),service.from('qb_sync_config').select('reconciled_at,reconcile_cursor,gateway_error,gateway_last_polled_at').eq('id',true).single()]);
      for(const result of counts)if(result.error)throw new Error(result.error.message);
      return json(200,{pending:counts[0].count,errors:counts[1].count,notifications:counts[2].count,reconciledAt:counts[3].data?.reconciled_at,reconciling:!!counts[3].data?.reconcile_cursor,gatewayError:counts[3].data?.gateway_error,gatewayLastPolledAt:counts[3].data?.gateway_last_polled_at});
    }
    if(body.action==='run')return json(200,await qb.drain());
    if(body.action==='reconcile'){await qb.reconcile();return json(200,{success:true});}
    if(body.action==='retry'){
      if(!['customers','invoices','items'].includes(body.entity)||!body.id)return json(400,{error:'Invalid record.'});
      const row=await qb.local(body.entity,body.id);if(!row)return json(404,{error:'Record not found.'});
      if(body.resolution==='quickbooks'){
        if(!row.qb_id)return json(400,{error:'Record is not linked.'});
        await service.from(body.entity).update({qb_sync_status:'synced'}).eq('id',row.id);
        const q=await qb.read(body.entity==='customers'?'Customer':body.entity==='items'?'Item':'Invoice',row.qb_id);
        if(body.entity==='customers')await qb.importCustomer(q);else if(body.entity==='invoices')await qb.importInvoice(q);else await qb.importItem(q);
        await service.from('qb_sync_jobs').update({state:'done',error:'Resolved using QuickBooks.'}).eq('entity',body.entity).eq('record_id',row.id).neq('state','done');
      }else{
        if(body.resolution==='software'&&row.qb_id){
          const q=await qb.read(body.entity==='customers'?'Customer':body.entity==='items'?'Item':'Invoice',row.qb_id);
          const {itemFields,customerFromQB,invoiceFromQB,invoiceFields}=await import('../_shared/quickbooks-mapping.ts');
          const baseline=body.entity==='customers'?customerFromQB(q):body.entity==='items'?itemFields(q):invoiceFields(invoiceFromQB(q));
          await service.from(body.entity).update({qb_snapshot:baseline}).eq('id',row.id);
        }
        const inserted=await service.from('qb_sync_jobs').upsert({entity:body.entity,record_id:row.id,version:row.qb_sync_version,realm_id:qb.connection.realm_id,state:'pending',available_at:new Date().toISOString(),error:null},{onConflict:'entity,record_id,version'});
        if(inserted.error)throw new Error(inserted.error.message);
        await service.from('qb_sync_jobs').update({state:'pending',available_at:new Date().toISOString(),error:null}).eq('entity',body.entity).eq('record_id',row.id).eq('version',row.qb_sync_version);
        await service.from(body.entity).update({qb_sync_status:'pending',qb_sync_error:null}).eq('id',row.id);
      }
      return json(200,await qb.drain());
    }
    if(body.action==='record-payment'){
      const invoice=await qb.local('invoices',body.id);if(!invoice?.qb_id)return json(400,{error:'Sync the invoice before recording payment.'});
      const amount=Number(body.amount);if(!Number.isFinite(amount)||amount<=0||Math.abs(Math.round(amount*100)/100-amount)>1e-8)return json(400,{error:'Enter a positive payment amount.'});
      if(!body.request_id||!/^[a-zA-Z0-9-]{8,60}$/.test(body.request_id))return json(400,{error:'Payment request identifier required.'});
      const owner=crypto.randomUUID();
      const lease=await service.rpc('qb_take_lease',{owner_id:owner});
      if(lease.error)throw new Error(lease.error.message);
      if(!lease.data)return json(409,{error:'Synchronization is busy. Try the payment again in a moment.'});
      try{await qb.recordPayment(invoice.id,amount,body.request_id);return json(200,{success:true});}
      finally{await service.from('qb_sync_config').update({lease_owner:null,lease_until:null}).eq('id',true).eq('lease_owner',owner);}
    }
    return json(400,{error:'Unknown synchronization action.'});
  }catch(e){return json(409,{error:(e as Error).message});}
});
