import {reconcileReport} from '../supabase/functions/_shared/assistant-report.ts'
const base=()=>({records:[{id:'a',group_key:'d1',label:'Driver A',value:2},{id:'b',group_key:'d1',label:'Driver A',value:3},{id:'c',group_key:'d2',label:'Driver B',value:1}],groups:[{group_key:'d1',count:2,sum:5},{group_key:'d2',count:1,sum:1}],count:3,sum:6,money:false,metric_label:'Loads',group_label:'Driver',scope:'Tomorrow, scheduled date',entity:'jobs'})
function rejects(data:unknown){let failed=false;try{reconcileReport(data)}catch{failed=true}if(!failed)throw new Error('Unverified data accepted')}
Deno.test('reconciles source IDs, each group, record count and grand total',()=>{const r=reconcileReport(base());if(r.results.rows.at(-1)?.[2]!=='6')throw new Error('Wrong total')})
Deno.test('withholds incomplete source pages',()=>{const d=base();d.records.pop();rejects(d)})
Deno.test('withholds invented totals even when displayed arithmetic might agree',()=>{const d=base();d.groups[0].sum=9;d.sum=10;rejects(d)})
Deno.test('withholds duplicate IDs and missing values',()=>{const d=base();d.records[1].id='a';rejects(d);const n=base();n.records[0].value=null as unknown as number;rejects(n)})
Deno.test('empty dataset is a verified zero',()=>{const d={...base(),records:[],groups:[],count:0,sum:0};if(reconcileReport(d).results.rows[0][2]!=='0')throw new Error('Zero failed')})
Deno.test('money is reconciled in cents',()=>{const d={...base(),money:true,records:[{id:'a',group_key:'d1',label:'A',value:0.1},{id:'b',group_key:'d1',label:'A',value:0.2}],groups:[{group_key:'d1',count:2,sum:0.3}],count:2,sum:0.3};if(reconcileReport(d).results.rows.at(-1)?.[2]!=='$0.30')throw new Error('Money failed')})
