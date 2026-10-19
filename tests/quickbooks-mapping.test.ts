import {mergeFields,SyncConflict,invoiceFields,invoiceFromQB,invoiceToQB,customerFromQB,customerToQB} from '../supabase/functions/_shared/quickbooks-mapping.ts';
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw new Error(message);}
Deno.test('Existing links without a baseline require review instead of overwriting QuickBooks',()=>{
  assert(mergeFields({city:'Berlin'},{city:'Berlin'},null).city==='Berlin');
  let rejected=false;try{mergeFields({city:'Berlin'},{city:'Wooster'},null);}catch(e){rejected=e instanceof SyncConflict;}assert(rejected);
});
Deno.test('JSONB object key order does not turn a one-sided invoice edit into a conflict',()=>{
  const base={lines:[{qty:2,amount:250,item_qb_id:'19',unit_price:125,description:'',tax_code:'NON'}]};
  const remote={lines:[{item_qb_id:'19',description:'',qty:2,unit_price:125,amount:250,tax_code:'NON'}]};
  const local={lines:[{item_qb_id:'19',description:'',qty:3,unit_price:125,amount:375,tax_code:'NON'}]};
  assert(mergeFields(local,remote,base).lines[0].qty===3);
});
Deno.test('Three-way merge keeps unrelated changes but rejects overlapping field changes',()=>{
  const merged=mergeFields({city:'Berlin',phone:'old'},{city:'old',phone:'new'},{city:'old',phone:'old'});
  assert(merged.city==='Berlin'&&merged.phone==='new');
  let rejected=false;try{mergeFields({city:'A'},{city:'B'},{city:'old'});}catch(e){rejected=e instanceof SyncConflict;}assert(rejected);
});
Deno.test('Customer address changes preserve remote additional address lines and structured names',()=>{
  const previous={Id:'1',GivenName:'John',FamilyName:'Smith',DisplayName:'Company',BillAddr:{Line1:'Old',Line2:'Suite 2',City:'Old'}};
  const fields={...customerFromQB(previous),street_address:'New'};
  const result=customerToQB(fields,previous);assert(result.BillAddr.Line2==='Suite 2');assert(!('FamilyName'in result));assert(result.DisplayName==='Company');
});
Deno.test('Invoice writes reject missing items and invalid quantities, and calculate cents consistently',()=>{
  const fields=invoiceFields({qb_customer_id:'1',lines:[{item_qb_id:'2',qty:3,unit_price:0.1,amount:0.3}]});
  assert(invoiceToQB(fields).Line[0].Amount===0.3);
  for(const line of [{qty:1,unit_price:2},{item_qb_id:'2',qty:0,unit_price:2},{item_qb_id:'2',qty:1,unit_price:-1}]){
    let rejected=false;try{invoiceToQB(invoiceFields({qb_customer_id:'1',lines:[line]}));}catch{rejected=true;}assert(rejected);
  }
});
Deno.test('Imported invoices retain the full accounting billing address independently of customer edits',()=>{
 const q={Id:'1',CustomerRef:{value:'2',name:'Historical company'},BillAddr:{Line1:'Old address',Line2:'Suite 2',City:'Old city',CountrySubDivisionCode:'OH',PostalCode:'44654',Country:'USA'},Line:[],TotalAmt:100,Balance:50};
 const invoice=invoiceFromQB(q);assert(invoice.qb_bill_to.street_address==='Old address');assert(invoice.qb_bill_to.street_extra[0]==='Suite 2');assert(invoice.balance===50);
});
