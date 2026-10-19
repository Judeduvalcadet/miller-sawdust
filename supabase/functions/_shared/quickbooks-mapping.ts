export type Row = Record<string, any>;
const text = (v: unknown) => String(v ?? '').trim();
export const money = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;
export class SyncConflict extends Error {}
function stable(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable((value as Row)[k])).join(',')+'}';
  return JSON.stringify(value)??'null';
}

export function mergeFields(local: Row, remote: Row, baseline: Row | null): Row {
  if (!baseline) {
    if (Object.keys(local).some(key=>stable(local[key])!==stable(remote[key]))) throw new SyncConflict('This existing QuickBooks record needs an initial review. Choose which version to keep before syncing.');
    return remote;
  }
  const merged = { ...remote };
  for (const key of Object.keys(local)) {
    const l = stable(local[key]), r = stable(remote[key]), b = stable(baseline[key]);
    if (l !== b && r !== b && l !== r) throw new SyncConflict(`Both systems changed ${key}. Review the record before retrying.`);
    if (l !== b) merged[key] = local[key];
  }
  return merged;
}
export function itemFields(q:Row):Row {
  return {name:q.name??q.Name,description:q.description??q.Description??'',unit_price:money(q.unit_price??q.UnitPrice),active:(q.active??q.Active)!==false};
}
export function customerFields(row: Row): Row {
  return Object.fromEntries(['name','company_name','street_address','city','state','zip_code','country','phone','email'].map(k=>[k,text(row[k])]).concat([['active',row.active !== false]] as any));
}
export function customerFromQB(q: Row): Row {
  return customerFields({ name: [q.GivenName,q.MiddleName,q.FamilyName].filter(Boolean).join(' ') || q.DisplayName,
    company_name:q.CompanyName || '',street_address:q.BillAddr?.Line1,city:q.BillAddr?.City,
    state:q.BillAddr?.CountrySubDivisionCode,zip_code:q.BillAddr?.PostalCode,country:q.BillAddr?.Country,
    email:q.PrimaryEmailAddr?.Address,phone:q.PrimaryPhone?.FreeFormNumber,active:q.Active });
}
export function customerToQB(row: Row, previous: Row = {}): Row {
  const old=customerFromQB(previous);
  const displayName=previous.Id&&row.company_name===old.company_name&&row.name===old.name?previous.DisplayName:row.company_name||row.name;
  const result: Row = { DisplayName: displayName, CompanyName: row.company_name,
    BillAddr:{...previous.BillAddr,Line1:row.street_address,City:row.city,CountrySubDivisionCode:row.state,PostalCode:row.zip_code,Country:row.country},
    PrimaryEmailAddr:{Address:row.email},PrimaryPhone:{FreeFormNumber:row.phone},Active:row.active };
  if (!previous.Id || customerFromQB(previous).name !== row.name) Object.assign(result,{GivenName:row.name,MiddleName:'',FamilyName:''});
  return result;
}
export function invoiceFields(row: Row): Row {
  return { doc_number:text(row.doc_number),qb_customer_id:text(row.qb_customer_id),txn_date:text(row.txn_date),due_date:text(row.due_date),note:text(row.note),
    lines:(row.lines || []).map((l:Row)=>({item_qb_id:text(l.item_qb_id),description:text(l.description),qty:Number(l.qty ?? 1),unit_price:money(l.unit_price),amount:money(l.amount ?? Number(l.qty ?? 1)*Number(l.unit_price || 0)),tax_code:text(l.tax_code || 'NON')})) };
}
export function invoiceFromQB(q:Row):Row {
  return { qb_bill_to:{company_name:q.CustomerRef?.name||'',name:q.CustomerRef?.name||'',street_address:q.BillAddr?.Line1||'',street_extra:[q.BillAddr?.Line2,q.BillAddr?.Line3,q.BillAddr?.Line4,q.BillAddr?.Line5].filter(Boolean),city:q.BillAddr?.City||'',state:q.BillAddr?.CountrySubDivisionCode||'',zip_code:q.BillAddr?.PostalCode||'',country:q.BillAddr?.Country||''},qb_customer_id:String(q.CustomerRef?.value || ''),doc_number:q.DocNumber || '',txn_date:q.TxnDate,due_date:q.DueDate || q.TxnDate,
    total:money(q.TotalAmt),balance:money(q.Balance),status:money(q.Balance)<=0?'paid':'open',note:q.CustomerMemo?.value || '',
    lines:(q.Line || []).filter((l:Row)=>l.DetailType==='SalesItemLineDetail').map((l:Row)=>({name:l.SalesItemLineDetail.ItemRef?.name || l.Description || 'Item',item_qb_id:String(l.SalesItemLineDetail.ItemRef?.value || ''),description:l.Description || '',qty:Number(l.SalesItemLineDetail.Qty ?? 1),unit_price:money(l.SalesItemLineDetail.UnitPrice ?? l.Amount),amount:money(l.Amount),tax_code:l.SalesItemLineDetail.TaxCodeRef?.value || 'NON'})) };
}
export function invoiceToQB(row:Row):Row {
  if (!row.qb_customer_id) throw new Error('Invoice customer is not connected to QuickBooks.');
  if (!row.lines?.length) throw new Error('An invoice needs at least one line.');
  return { CustomerRef:{value:row.qb_customer_id},DocNumber:row.doc_number,TxnDate:row.txn_date,DueDate:row.due_date,
    CustomerMemo:{value:row.note},Line:row.lines.map((l:Row)=>{
      if (!l.item_qb_id || !Number.isFinite(l.qty) || l.qty<=0 || !Number.isFinite(l.unit_price) || l.unit_price<0) throw new Error('Invoice lines need a QuickBooks item, positive quantity, and nonnegative price.');
      return {DetailType:'SalesItemLineDetail',Description:l.description,Amount:money(l.qty*l.unit_price),SalesItemLineDetail:{ItemRef:{value:l.item_qb_id},Qty:l.qty,UnitPrice:l.unit_price,TaxCodeRef:{value:l.tax_code || 'NON'}}};
    }) };
}
