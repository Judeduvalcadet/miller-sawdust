import { DATA_FIELDS, validateRecordQuery, recordTable } from '../supabase/functions/_shared/assistant-data.ts'
function assert(value: unknown) { if (!value) throw new Error('Assertion failed') }
Deno.test('supports operational identifiers and complete load/invoice details', () => {
 for (const [entity, fields] of Object.entries({jobs:['id','loads','load_configuration','customer_id'],invoices:['doc_number','billing_address','lines','job_id'],customers:['street_address','billing_preference','email']})) {
  assert(fields.every(f => DATA_FIELDS[entity].includes(f)))
 }
})
Deno.test('rejects credentials, arbitrary tables, injected fields and invalid pagination', () => {
 for (const input of [{entity:'driver_sessions'},{entity:'drivers',fields:['pin_hash']},{entity:'jobs',fields:['*,drivers(*)']},{entity:'jobs',offset:-1},{entity:'jobs',filters:[{field:'status',op:'delete',value:'pending'}]}]) {
  let rejected=false;try {validateRecordQuery(input)}catch{rejected=true}assert(rejected)
 }
})
Deno.test('record lists preserve all 50 database rows without model transcription', () => {
 const records=Array.from({length:50},(_,i)=>({id:`job-${i}`,loads:[{configuration:'Pine',yards:35}],quantity:i}));
 const table=recordTable('Tomorrow',records,['id','loads','quantity']);
 assert(table.rows.length===51);assert(table.rows[49][0]==='job-49');assert(table.rows[49][1].includes('Pine'));assert(table.rows[50][2]==='1225')
})
Deno.test('filter and page definitions retain exact matching semantics',()=>{
 const query=validateRecordQuery({entity:'invoices',fields:['doc_number','total'],offset:50,filters:[{field:'doc_number',op:'eq',value:'17963'}]});
 assert(query.offset===50);assert(query.fields.includes('id'));assert(query.filters[0].value==='17963')
})
