import { decryptedConnection, encryptedConnection } from './quickbooks-vault.ts';
import { service } from './mod.ts';
import { quickBooksRuntime } from './quickbooks-runtime.ts';
import { itemFields, customerFields, customerFromQB, customerToQB, invoiceFields, invoiceFromQB, invoiceToQB, mergeFields, money, SyncConflict, type Row } from './quickbooks-mapping.ts';

function checked(result: { data: any; error: any }) { if (result.error) throw new Error(result.error.message); return result.data; }
const now = () => new Date().toISOString();
async function requestId(...parts:unknown[]) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('').slice(0,48);
}

export class QuickBooksSync {
  connection:Row;
  requestDeadline?:number;
  constructor(connection:Row) { this.connection=connection; }
  static async open() {
    const runtime = quickBooksRuntime(Deno.env.toObject());
    const stored=checked(await service.from('qb_tokens').select('*').limit(1).maybeSingle());
    const connection=stored ? await decryptedConnection(stored) : null;
    if (!connection) throw new Error('QuickBooks is disconnected. Pending changes are retained.');
    if (runtime.environment === 'production' && connection.oauth_client_id !== Deno.env.get('QB_CLIENT_ID')) throw new Error('Connect the JobYard QuickBooks app from Settings before synchronizing.');
    const config=checked(await service.from('qb_sync_config').select('*').eq('id',true).maybeSingle());
    if (!config?.enabled || config.realm_id!==connection.realm_id) throw new Error('This QuickBooks company is not enabled for synchronization.');
    return new QuickBooksSync(connection);
  }
  timeoutMs() { return Math.max(1,Math.min(12000,(this.requestDeadline || Date.now()+12000)-Date.now())); }
  async refresh() {
    const id=Deno.env.get('QB_CLIENT_ID'),secret=Deno.env.get('QB_CLIENT_SECRET');
    if (!id||!secret) throw new Error('QuickBooks credentials are missing.');
    const res=await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',{method:'POST',signal:AbortSignal.timeout(this.timeoutMs()),headers:{Authorization:`Basic ${btoa(`${id}:${secret}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:this.connection.refresh_token})});
    const data=await res.json();
    if (!res.ok||!data.access_token) throw new Error('QuickBooks token renewal failed. Reconnect from Settings.');
    const patch={access_token:data.access_token,refresh_token:data.refresh_token,access_token_expires_at:new Date(Date.now()+data.expires_in*1000).toISOString(),refresh_token_expires_at:new Date(Date.now()+data.x_refresh_token_expires_in*1000).toISOString(),updated_at:now()};
    checked(await service.from('qb_tokens').update(await encryptedConnection(patch)).eq('id',this.connection.id));
    Object.assign(this.connection,patch);
  }
  async api(path:string,body?:Row,key?:string,retry=true):Promise<Row> {
    if(this.requestDeadline&&Date.now()>this.requestDeadline)throw new Error('Synchronization time budget reached; the queued change will resume on retry.');
    if (new Date(this.connection.access_token_expires_at).getTime()<Date.now()+60000) await this.refresh();
    const runtime=quickBooksRuntime(Deno.env.toObject());
    const url=new URL(`${runtime.apiBase}/v3/company/${encodeURIComponent(this.connection.realm_id)}/${path}`);
    url.searchParams.set('minorversion','73'); if(key)url.searchParams.set('requestid',key);
    const res=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.connection.access_token}`,Accept:'application/json','Content-Type':'application/json'},signal:AbortSignal.timeout(this.timeoutMs()),...(body?{body:JSON.stringify(body)}:{})});
    if(res.status===401&&retry){await this.refresh();return this.api(path,body,key,false);}
    const tid=res.headers.get('intuit_tid');
    if(tid) await service.from('qb_logs').insert({action:'api-request',status:res.ok?'ok':'error',message:'QuickBooks API response',details:{intuit_tid:tid.slice(0,128),http_status:res.status}});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.Fault) {
      const e=data.Fault?.Error?.[0];
      const code=String(e?.code || res.status).replace(/[^0-9A-Za-z_-]/g,'').slice(0,20);
      if(code==='6220'&&path==='customer'&&body?.Active===false)throw new SyncConflict('QuickBooks cannot archive a customer with an open balance. Settle the balance before retrying.');
      throw new Error(`QuickBooks ${code}: Request rejected. Review the record and connection settings, then retry. Contact JobYard support if it continues.`);
    }
    return data;
  }
  async read(entity:string,id:string) { return (await this.api(`${entity.toLowerCase()}/${encodeURIComponent(id)}`))[entity]; }
  async query(entity:string,where='') {
    const rows:Row[]=[];
    for(let start=1;;start+=100){
      const query=`select * from ${entity}${where?' where '+where:''} startposition ${start} maxresults 100`;
      const data=await this.api('query?query='+encodeURIComponent(query));const batch=data.QueryResponse?.[entity]||[];rows.push(...batch);if(batch.length<100)break;
    }
    return rows;
  }
  async local(table:string,id:string) { return checked(await service.from(table).select('*').eq('id',id).maybeSingle()); }
  async stamp(table:string,row:Row,q:Row,snapshot:Row,extra:Row={}) {
    // Persist identity even if an edit arrived during the API call. The next
    // queued revision must update this same QBO record, never create another.
    checked(await service.from(table).update({qb_id:String(q.Id),qb_realm_id:this.connection.realm_id,qb_sync_token:String(q.SyncToken),qb_snapshot:snapshot}).eq('id',row.id));
    checked(await service.from(table).update({qb_id:String(q.Id),qb_realm_id:this.connection.realm_id,qb_sync_token:String(q.SyncToken),qb_snapshot:snapshot,qb_sync_status:'synced',qb_sync_error:null,...(table!=='invoices'?{qb_last_synced_at:now()}:{}),...extra}).eq('id',row.id).eq('qb_sync_version',row.qb_sync_version));
  }
  async pushCustomer(id:string,retryStale=true):Promise<Row|undefined> {
    const row=await this.local('customers',id);if(!row)return;
    const linked=row.qb_id&&row.qb_realm_id===this.connection.realm_id;
    const remote=linked?await this.read('Customer',row.qb_id):{};
    const local=customerFields(row),base=linked?row.qb_snapshot:null;
    const merged=linked?mergeFields(local,customerFromQB(remote),base):local;
    const body={...customerToQB(merged,remote),...(linked?{Id:remote.Id,SyncToken:remote.SyncToken,sparse:true}:{})};
    let q:Row;
    try {
      q=(await this.api('customer',body,await requestId('customer',this.connection.realm_id,id,row.qb_sync_version,linked?'update':'create',linked?remote.SyncToken:null))).Customer;
    } catch(error) {
      // A QuickBooks-side edit can land after our read. Re-read and merge once;
      // never resend the stale object or bypass overlapping-field conflicts.
      if(retryStale&&error instanceof Error&&error.message.startsWith('QuickBooks 5010:'))return this.pushCustomer(id,false);
      throw error;
    }
    await this.stamp('customers',row,q,customerFromQB(q),customerFromQB(q));return q;
  }
  async pushItem(id:string) {
    const row=await this.local('items',id);if(!row)throw new Error('Invoice item was removed.');
    const linked=row.qb_id&&row.qb_realm_id===this.connection.realm_id;
    const previous=linked?await this.read('Item',row.qb_id):null;
    const income=previous?.IncomeAccountRef || (await this.query('Account',"AccountType = 'Income' and Active = true"))[0];
    const incomeRef=income?.value?income:{value:income?.Id};
    if(!incomeRef.value)throw new Error('QuickBooks needs an active income account for invoice items.');
    const merged=previous?mergeFields(itemFields(row),itemFields(previous),row.qb_snapshot):itemFields(row);
    const body={Name:merged.name,Description:merged.description,UnitPrice:merged.unit_price,Type:previous?.Type||'Service',IncomeAccountRef:incomeRef,Active:merged.active,...(previous?{Id:previous.Id,SyncToken:previous.SyncToken,sparse:true}:{})};
    const q=(await this.api('item',body,await requestId('item',this.connection.realm_id,id,row.qb_sync_version,linked?'update':'create'))).Item;
    await this.stamp('items',row,q,itemFields(q),itemFields(q));return q;
  }
  async ensureLines(lines:Row[]) {
    const result=[];
    for(const line of lines||[]) {
      let item=line.item_id?await this.local('items',line.item_id):null;
      if(!item&&line.item_qb_id)item=checked(await service.from('items').select('*').eq('qb_id',line.item_qb_id).eq('qb_realm_id',this.connection.realm_id).maybeSingle());
      if(!item){
        const matches=checked(await service.from('items').select('*').eq('name',line.name||'Delivery service'));
        if(matches.length===1)item=matches[0];
        else item=checked(await service.from('items').insert({name:line.name||'Delivery service',unit_price:money(line.unit_price),item_type:'Service'}).select().single());
      }
      if(!item.qb_id||item.qb_realm_id!==this.connection.realm_id){await this.pushItem(item.id);item=await this.local('items',item.id);}
      result.push({...line,item_id:item.id,item_qb_id:item.qb_id});
    }
    return result;
  }
  async pushInvoice(id:string) {
    const row=await this.local('invoices',id);if(!row)return;
    const customer=await this.local('customers',row.customer_id);if(!customer)throw new Error('Invoice needs a customer.');
    if(!customer.qb_id||customer.qb_realm_id!==this.connection.realm_id)await this.pushCustomer(customer.id);
    const linkedCustomer=await this.local('customers',customer.id);
    const linked=row.qb_id&&row.qb_realm_id===this.connection.realm_id;
    const previous=linked?await this.read('Invoice',row.qb_id):null;
    if(previous?.CurrencyRef?.value&&previous.CurrencyRef.value!=='USD')throw new SyncConflict('This software currently supports USD invoices. Edit other currencies in QuickBooks.');
    if(row.qb_archived){
      if(previous){
        if(money(previous.Balance)!==money(previous.TotalAmt))throw new Error('An invoice with payments must have those payments reviewed before it can be voided.');
        await this.api('invoice?operation=void',{Id:previous.Id,SyncToken:previous.SyncToken},await requestId('void-invoice',id,row.qb_sync_version));
      }
      checked(await service.from('invoices').update({qb_sync_status:'synced',qb_sync_error:null}).eq('id',id).eq('qb_sync_version',row.qb_sync_version));return;
    }
    if(linkedCustomer.active===false)throw new Error('Reactivate this customer before creating or editing an invoice.');
    if(previous&&((previous.Line||[]).some((l:Row)=>!['SalesItemLineDetail','SubTotalLineDetail'].includes(l.DetailType))||money(previous.TxnTaxDetail?.TotalTax)>0))throw new SyncConflict('This invoice has tax, discounts, or special lines. Edit it in QuickBooks to preserve its accounting details.');
    const lines=await this.ensureLines(row.lines);
    const local=invoiceFields({...row,lines,qb_customer_id:linkedCustomer.qb_id});
    const remote=previous?invoiceFields(invoiceFromQB(previous)):null;
    const merged=previous?mergeFields(local,remote!,row.qb_snapshot):local;
    if(previous&&row.qb_snapshot?.balance===0&&money(row.total)!==money(previous.TotalAmt))throw new SyncConflict('Review payments before changing the amount of a paid invoice.');
    const q=(await this.api('invoice',{...invoiceToQB(merged),...(previous?{Id:previous.Id,SyncToken:previous.SyncToken,sparse:true}:{})},await requestId('invoice',this.connection.realm_id,id,row.qb_sync_version,linked?'update':'create'))).Invoice;
    // Establish the mapping before payment work so timeout/retry cannot create a second invoice.
    checked(await service.from('invoices').update({qb_id:String(q.Id),qb_realm_id:this.connection.realm_id,qb_sync_token:String(q.SyncToken)}).eq('id',id));
    const desired=row.status==='paid'?0:row.qb_snapshot?.balance===0&&row.balance>0?money(q.TotalAmt):null;
    if(desired!==null)await this.setBalance(q,desired,id,row.qb_sync_version);
    const final=await this.read('Invoice',q.Id);
    const fields=invoiceFromQB(final);
    await this.stamp('invoices',row,final,{...invoiceFields(fields),balance:fields.balance,total:fields.total},{...fields,customer_id:customer.id,lines:fields.lines.map((l:Row,i:number)=>({...l,item_id:lines[i]?.item_id||null})),qb_archived:false});
  }
  async setBalance(invoice:Row,target:number,localId:string,version:string|number) {
    const balance=money(invoice.Balance),total=money(invoice.TotalAmt);
    if(target<0||target>total)throw new Error('Payment balance is outside the invoice total.');
    if(target<balance){
      const amount=money(balance-target);
      const payment=(await this.api('payment',{CustomerRef:invoice.CustomerRef,TotalAmt:amount,TxnDate:new Date().toISOString().slice(0,10),PrivateNote:'Recorded in JobYard',Line:[{Amount:amount,LinkedTxn:[{TxnId:String(invoice.Id),TxnType:'Invoice'}]}]},await requestId('payment',this.connection.realm_id,localId,version,target))).Payment;
      await this.importPayment(payment,'app');
    } else if(target>balance){
      const payments=checked(await service.from('qb_payments').select('*').eq('realm_id',this.connection.realm_id).eq('origin','app').eq('deleted',false));
      const own=payments.filter((p:Row)=>p.linked_invoice_ids.includes(String(invoice.Id)));
      if(target!==total||!own.length||money(own.reduce((s:number,p:Row)=>s+Number(p.amount),0))!==money(total-balance))throw new SyncConflict('Payments entered in QuickBooks must be reversed in QuickBooks.');
      for(const p of own){const latest=await this.read('Payment',p.qb_id);await this.api('payment?operation=delete',{Id:p.qb_id,SyncToken:latest.SyncToken},await requestId('delete-payment',p.qb_id,version));await this.deletePayment(p.qb_id);}
    }
  }
  async recordPayment(localId:string,amount:number,key:string) {
    const invoice=await this.local('invoices',localId);
    if(!invoice?.qb_id||invoice.qb_realm_id!==this.connection.realm_id)throw new Error('Sync the invoice first.');
    let request=checked(await service.from('qb_payment_requests').select('*').eq('request_id',key).maybeSingle());
    if(request&&(request.invoice_id!==localId||money(request.amount)!==money(amount)))throw new Error('A payment request identifier cannot be reused for a different payment.');
    if(request?.qb_payment_id){await this.importPayment(await this.read('Payment',request.qb_payment_id),'app');await this.importInvoice(await this.read('Invoice',invoice.qb_id));return;}
    const remote=await this.read('Invoice',invoice.qb_id);
    if(!request){
      if(amount>Number(remote.Balance))throw new Error('Payment exceeds the remaining balance.');
      const inserted=await service.from('qb_payment_requests').insert({request_id:key,invoice_id:localId,amount});
      if(inserted.error&&inserted.error.code!=='23505')throw new Error(inserted.error.message);
      request=checked(await service.from('qb_payment_requests').select('*').eq('request_id',key).single());
      if(request.invoice_id!==localId||money(request.amount)!==money(amount))throw new Error('Payment request identifier collision.');
    }
    const payment=(await this.api('payment',{CustomerRef:remote.CustomerRef,TotalAmt:amount,TxnDate:new Date().toISOString().slice(0,10),PrivateNote:'Recorded in JobYard',Line:[{Amount:amount,LinkedTxn:[{TxnId:String(remote.Id),TxnType:'Invoice'}]}]},await requestId('manual-payment',this.connection.realm_id,key))).Payment;
    checked(await service.from('qb_payment_requests').update({qb_payment_id:String(payment.Id)}).eq('request_id',key));
    await this.importPayment(payment,'app');
    await this.importInvoice(await this.read('Invoice',invoice.qb_id));
  }
  async importCustomer(q:Row) {
    const existing=checked(await service.from('customers').select('*').eq('qb_id',String(q.Id)).eq('qb_realm_id',this.connection.realm_id).maybeSingle());
    const remote=customerFromQB(q);let fields=remote;
    if(existing&&['pending','error'].includes(existing.qb_sync_status))fields=mergeFields(customerFields(existing),remote,existing.qb_snapshot);
    const values={...fields,qb_id:String(q.Id),qb_realm_id:this.connection.realm_id,qb_sync_token:String(q.SyncToken),qb_last_synced_at:now(),qb_snapshot:remote,qb_sync_status:existing&&['pending','error'].includes(existing.qb_sync_status)?existing.qb_sync_status:'synced',qb_sync_error:existing?.qb_sync_status==='error'?existing.qb_sync_error:null};
    return checked(await (existing?service.from('customers').update(values).eq('id',existing.id):service.from('customers').insert(values)).select().single());
  }
  async importItem(q:Row) {
    const existing=checked(await service.from('items').select('*').eq('qb_id',String(q.Id)).eq('qb_realm_id',this.connection.realm_id).maybeSingle());
    if(existing&&['pending','error'].includes(existing.qb_sync_status))return existing;
    const fields={name:q.Name,description:q.Description||'',unit_price:money(q.UnitPrice),item_type:q.Type,active:q.Active!==false};
    const values={...fields,qb_id:String(q.Id),qb_realm_id:this.connection.realm_id,qb_sync_token:String(q.SyncToken),qb_last_synced_at:now(),qb_snapshot:fields,qb_sync_status:'synced',qb_sync_error:null};
    return checked(await(existing?service.from('items').update(values).eq('id',existing.id):service.from('items').insert(values)).select().single());
  }
  async importInvoice(q:Row) {
    let customer=checked(await service.from('customers').select('*').eq('qb_id',String(q.CustomerRef.value)).eq('qb_realm_id',this.connection.realm_id).maybeSingle());
    if(!customer)customer=await this.importCustomer(await this.read('Customer',q.CustomerRef.value));
    const existing=checked(await service.from('invoices').select('*').eq('qb_id',String(q.Id)).eq('qb_realm_id',this.connection.realm_id).maybeSingle());
    const fields=invoiceFromQB(q);
    if(existing&&['pending','error'].includes(existing.qb_sync_status)){
      // The outbound job owns pending local edits; it performs a three-way merge.
      return existing;
    }
    for(const l of fields.lines){const item=checked(await service.from('items').select('id').eq('qb_id',l.item_qb_id).eq('qb_realm_id',this.connection.realm_id).maybeSingle());l.item_id=item?.id||null;}
    const values={...fields,customer_id:customer.id,qb_id:String(q.Id),qb_realm_id:this.connection.realm_id,qb_sync_token:String(q.SyncToken),qb_snapshot:{...invoiceFields(fields),balance:fields.balance,total:fields.total},qb_sync_status:'synced',qb_sync_error:null,qb_archived:!!q.PrivateNote?.startsWith('Voided')};
    return checked(await(existing?service.from('invoices').update(values).eq('id',existing.id):service.from('invoices').insert({...values,source:'quickbooks'})).select().single());
  }
  async importPayment(q:Row,origin='quickbooks') {
    const existing=checked(await service.from('qb_payments').select('origin').eq('qb_id',String(q.Id)).maybeSingle());
    const customer=checked(await service.from('customers').select('id').eq('qb_id',String(q.CustomerRef?.value)).eq('qb_realm_id',this.connection.realm_id).maybeSingle());
    const ids=[...new Set((q.Line||[]).flatMap((l:Row)=>(l.LinkedTxn||[]).filter((x:Row)=>x.TxnType==='Invoice').map((x:Row)=>String(x.TxnId))))];
    checked(await service.from('qb_payments').upsert({qb_id:String(q.Id),realm_id:this.connection.realm_id,customer_id:customer?.id||null,amount:money(q.TotalAmt),txn_date:q.TxnDate,linked_invoice_ids:ids,origin:existing?.origin||origin,deleted:false,payload:q,updated_at:now()}));
    for(const id of ids)await this.importInvoice(await this.read('Invoice',String(id)));
  }
  async deletePayment(id:string) {
    const payment=checked(await service.from('qb_payments').select('*').eq('qb_id',id).eq('realm_id',this.connection.realm_id).maybeSingle());
    if(!payment)return;
    checked(await service.from('qb_payments').update({deleted:true,updated_at:now()}).eq('qb_id',id));
    for(const invoiceId of payment.linked_invoice_ids)await this.importInvoice(await this.read('Invoice',invoiceId));
  }
  async pullEvent(event:Row) {
    if(event.realm_id!==this.connection.realm_id)throw new Error('Company mismatch.');
    if(!['Customer','Invoice','Payment','Item'].includes(event.entity_name))return;
    if(event.operation==='Delete'){
      if(event.entity_name==='Payment')return this.deletePayment(event.entity_id);
      if(event.entity_name==='Invoice')checked(await service.from('invoices').update({qb_archived:true,qb_sync_status:'synced'}).eq('qb_id',event.entity_id).eq('qb_realm_id',this.connection.realm_id));
      return;
    }
    let q;
    try{q=await this.read(event.entity_name,event.entity_id);}
    catch(e){if(/QuickBooks (610|2500):/.test((e as Error).message))return;throw e;} // An older update can arrive after the deletion notification.

    if(event.entity_name==='Customer')await this.importCustomer(q);
    if(event.entity_name==='Item')await this.importItem(q);
    if(event.entity_name==='Invoice')await this.importInvoice(q);
    if(event.entity_name==='Payment')await this.importPayment(q);
  }
  async pullGatewayInbox() {
    const runtime=quickBooksRuntime(Deno.env.toObject());
    const url=Deno.env.get(runtime.environment==='sandbox'?'QB_SANDBOX_GATEWAY_URL':'QB_GATEWAY_URL'),key=Deno.env.get(runtime.environment==='sandbox'?'QB_SANDBOX_GATEWAY_KEY':'QB_GATEWAY_KEY');
    if(!url)return;
    if(url!==runtime.gateway||!key)throw new Error('QuickBooks gateway configuration is invalid.');
    const call=async(body:Row)=>{
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-jobyard-relay-key':key},body:JSON.stringify({...body,realm_id:this.connection.realm_id}),signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw new Error('Hosted notifications are temporarily unavailable. Outbound changes continue.');
      return await response.json();
    };
    const {events}=await call({action:'pull'});
    if(!Array.isArray(events)||events.length>30||events.some((e:Row)=>e.realm_id!==this.connection.realm_id))throw new Error('Gateway returned an invalid company batch.');
    if(events.length){
      checked(await service.from('qb_webhook_events').upsert(events,{onConflict:'event_key',ignoreDuplicates:true}));
      // Acknowledge only after durable local receipt. Repeated receipt is safe.
      await call({action:'ack',keys:events.map((e:Row)=>e.event_key)});
    }
  }
  async drain() {
    const owner=crypto.randomUUID();
    if(!checked(await service.rpc('qb_take_lease',{owner_id:owner})))return {busy:true};
    const report:{pushed:number,pulled:number,errors:number,relayError?:string}={pushed:0,pulled:0,errors:0};const deadline=Date.now()+35000;this.requestDeadline=deadline;
    try{
      const jobs=checked(await service.from('qb_sync_jobs').select('*').neq('state','done').lte('available_at',now()).eq('realm_id',this.connection.realm_id).order('created_at').limit(10));
      for(const job of jobs){if(Date.now()>deadline)break;
        const row=await this.local(job.entity,job.record_id);
        if(!row||Number(row.qb_sync_version)!==Number(job.version)){checked(await service.from('qb_sync_jobs').update({state:'done',error:'Superseded by a later edit.'}).eq('id',job.id));continue;}
        try{
          if(job.entity==='customers')await this.pushCustomer(job.record_id);
          if(job.entity==='items')await this.pushItem(job.record_id);
          if(job.entity==='invoices')await this.pushInvoice(job.record_id);
          checked(await service.from('qb_sync_jobs').update({state:'done',error:null,attempts:job.attempts+1}).eq('id',job.id));report.pushed++;
        }catch(e){
          const message=(e as Error).message.slice(0,1000),attempts=job.attempts+1;
          checked(await service.from('qb_sync_jobs').update({state:'error',attempts,error:message,available_at:e instanceof SyncConflict?'infinity':new Date(Date.now()+Math.min(300000,2000*2**Math.min(attempts,8))).toISOString()}).eq('id',job.id));
          checked(await service.from(job.entity).update({qb_sync_status:'error',qb_sync_error:message}).eq('id',job.record_id).eq('qb_sync_version',job.version));report.errors++;
        }
      }
      // Foreground accounting changes always get the first opportunity.
      if(Date.now()+2000<deadline){try{await this.reconcilePage();}catch{report.errors++;}}
      try{await this.pullGatewayInbox();checked(await service.from('qb_sync_config').update({gateway_error:null,gateway_last_polled_at:now()}).eq('id',true));}catch(e){report.relayError=(e as Error).message;await service.from('qb_sync_config').update({gateway_error:report.relayError,gateway_last_polled_at:now()}).eq('id',true);}
      const events=checked(await service.from('qb_webhook_events').select('*').is('processed_at',null).lte('available_at',now()).eq('realm_id',this.connection.realm_id).order('received_at').limit(15));
      for(const event of events){if(Date.now()>deadline)break;
        try{await this.pullEvent(event);checked(await service.from('qb_webhook_events').update({processed_at:now(),error:null}).eq('event_key',event.event_key));report.pulled++;}
        catch(e){checked(await service.from('qb_webhook_events').update({error:(e as Error).message,attempts:event.attempts+1,available_at:new Date(Date.now()+Math.min(300000,2000*2**Math.min(event.attempts+1,8))).toISOString()}).eq('event_key',event.event_key));report.errors++;}
      }
      return report;
    }finally{await service.from('qb_sync_config').update({lease_owner:null,lease_until:null}).eq('id',true).eq('lease_owner',owner);}
  }
  async reconcile() {
    checked(await service.from('qb_sync_config').update({reconcile_cursor:{entity:0,start:1,run:crypto.randomUUID()}}).eq('id',true));
  }
  async reconcilePage() {
    const config=checked(await service.from('qb_sync_config').select('reconcile_cursor').eq('id',true).single());
    const cursor=config.reconcile_cursor;if(!cursor)return;
    const entity=['Customer','Item','Invoice','Payment'][cursor.entity];
    const query=`select * from ${entity}${['Customer','Item'].includes(entity)?' where Active in (true,false)':''} startposition ${cursor.start} maxresults 20`;
    const batch=(await this.api('query?query='+encodeURIComponent(query))).QueryResponse?.[entity]||[];
    const rows=[];
    for(const q of batch)rows.push({event_key:await requestId('reconcile',cursor.run,entity,q.Id),realm_id:this.connection.realm_id,entity_name:entity,entity_id:String(q.Id),operation:'Update',source_updated_at:q.MetaData?.LastUpdatedTime||now(),payload:{reconciled:true}});
    if(rows.length)checked(await service.from('qb_webhook_events').upsert(rows,{onConflict:'event_key',ignoreDuplicates:true}));
    const next=batch.length===20?{...cursor,start:cursor.start+20}:cursor.entity<3?{...cursor,entity:cursor.entity+1,start:1}:null;
    checked(await service.from('qb_sync_config').update({reconcile_cursor:next,...(!next?{reconciled_at:now()}: {})}).eq('id',true));
  }
}
