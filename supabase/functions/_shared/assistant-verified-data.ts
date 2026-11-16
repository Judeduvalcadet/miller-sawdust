import { DATA_FIELDS, recordTable } from './assistant-data.ts'
import { reconcileReport } from './assistant-report.ts'
export const VERIFIED_DATA_TOOL={name:'verified_data',description:'Verified lookup and numeric reporting for EVERY available data category. Use records for original field values including phone numbers, addresses, dates, IDs, prices and nested configurations. Use count for complete counts, sum for additive numeric fields. Filters use exact allowlisted field names from describe_data. Never sum IDs, coordinates, prices or rates. No date filter is required for all-time counts. Source size is bounded: narrow filters if too large. Unsupported calculations must be withheld, not approximated.',input_schema:{type:'object',properties:{entity:{type:'string',enum:Object.keys(DATA_FIELDS)},fields:{type:'array',items:{type:'string'},maxItems:12},operation:{type:'string',enum:['records','count','sum']},value_field:{type:'string'},group_by:{type:'string'},filters:{type:'array',maxItems:10,items:{type:'object',properties:{field:{type:'string'},op:{type:'string',enum:['eq','gte','lte','is_null','contains']},value:{type:['string','number','boolean']}},required:['field','op'],additionalProperties:false}}},required:['entity','operation','fields'],additionalProperties:false}}
export function renderVerifiedData(data:any){
 if(!data||!Array.isArray(data.source)||data.source.length!==Number(data.count)||data.source.length>10000||new Set(data.source.map((r:any)=>r.id)).size!==data.source.length||data.source.some((r:any)=>!r.id))throw new Error('Source coverage verification failed.')
 const parts=String(data.scope || '').split('Filters: ')
 if(parts.length===2){const filters=JSON.parse(parts[1]);data.scope=parts[0]+(filters.length?filters.map((f:any)=>`${f.field.replaceAll('_',' ')} ${{eq:'equals',gte:'on or after',lte:'on or before',contains:'contains',is_null:'is empty'}[f.op] || f.op}${f.op==='is_null'?'':' '+String(f.value)}`).join('; '):'All records, no filters.')}
 if(data.operation==='records'){
  if(data.source.length>100)throw new Error('More than 100 records matched. Narrow the filters to display complete results.')
  // Do not invent totals for source lists, coerce null values to zero, or accept a model-written title.
  const table=recordTable(data.entity+' records',data.source,data.fields,false)
  return {reply:`${data.count} verified ${data.entity.replaceAll('_',' ')} records. ${data.scope}`,results:table,verification:`All ${data.count} unique source records were returned in one database snapshot. Displayed values are copied directly from the selected fields. ${data.scope}`}
 }
 const report=reconcileReport(data)
 report.results.title=data.entity.replaceAll('_',' ')+' report'
 if(data.operation==='count'){
   report.reply=`${data.count} ${data.entity.replaceAll('_',' ')}. ${data.scope}`
   report.results.columns=[data.group_label,'Count'];report.results.rows=report.results.rows.map(row=>[row[0],row[2]])
 }
 return report
}
