import type { AssistantResults } from './assistant-results.ts'
export const REPORT_TOOL = {name:'verified_report',description:'Calculate and independently verify complete numeric job/load or invoice reports. REQUIRED for counts, totals, sums and grouped breakdowns. Dates are inclusive. Loads means SUM(quantity), not number of jobs or length of loads array. Completed deliveries use job_type delivery and status completed; board schedules use scheduled_date and exclude cancelled. Use stable IDs for exact customer/driver filters. Return only supported metrics; ask a clarification if the requested meaning is unclear.',input_schema:{type:'object',properties:{entity:{type:'string',enum:['jobs','invoices']},date_field:{type:'string',enum:['scheduled_date','completed_at','txn_date','due_date']},start_date:{type:'string'},end_date:{type:'string'},group_by:{type:'string',enum:['none','driver','customer','status','truck_type']},metric:{type:'string',enum:['count','quantity','total','balance']},status:{type:'string'},job_type:{type:'string',enum:['delivery','pickup']},customer_id:{type:'string'},driver_id:{type:'string'}},required:['entity','date_field','start_date','end_date','group_by','metric'],additionalProperties:false}}
export function reconcileReport(data: any): {reply:string;results:AssistantResults;verification:string} {
  if(!data || !Array.isArray(data.records)||!Array.isArray(data.groups)||data.records.length!==Number(data.count)||data.records.length>10000) throw new Error('The complete source dataset was not available.')
  const seen=new Set<string>(), groups=new Map<string,{label:string;count:number;sum:number}>(); let total=0
  for(const r of data.records){
    if(!r.id||seen.has(r.id))throw new Error('Duplicate or missing source IDs.');seen.add(r.id)
    if(r.value==null || !Number.isFinite(Number(r.value)))throw new Error('A source record has a missing or invalid amount.')
    const value=Number(r.value);const scaled=data.money?Math.round(value*100):value
    if(data.money && Math.abs(value*100-scaled)>0.000001)throw new Error('A monetary value has unsupported fractional cents.')
    if(!Number.isSafeInteger(scaled))throw new Error('A value cannot be calculated safely.')
    const key=String(r.group_key), group=groups.get(key)||{label:r.label,count:0,sum:0};group.count++;group.sum+=scaled;groups.set(key,group);total+=scaled
    if(!Number.isSafeInteger(total)||!Number.isSafeInteger(group.sum))throw new Error('The amount exceeds safe calculation limits.')
  }
  if(groups.size!==data.groups.length)throw new Error('Group coverage did not reconcile.')
  const checkedGroups=new Set<string>()
  for(const g of data.groups){if(checkedGroups.has(String(g.group_key)))throw new Error('Duplicate verification groups.');checkedGroups.add(String(g.group_key));const actual=groups.get(String(g.group_key));const expected=data.money?Math.round(Number(g.sum)*100):Number(g.sum);if(!actual||actual.count!==Number(g.count)||actual.sum!==expected)throw new Error('A group did not match its source records.')}
  const expected=data.money?Math.round(Number(data.sum)*100):Number(data.sum)
  if(total!==expected)throw new Error('The grand total did not match its source records.')
  if(groups.size>100)throw new Error('More than 100 groups matched. Narrow the report range.')
  const display=(n:number)=>data.money?`$${(n/100).toFixed(2)}`:String(n)
  const rows=[...groups.entries()].sort((a,b)=>b[1].sum-a[1].sum||a[0].localeCompare(b[0])).map(([,g])=>[g.label,String(g.count),display(g.sum)])
  rows.push(['Total',String(data.count),display(total)])
  return {reply:`${display(total)} ${data.metric_label.toLowerCase()} across ${data.count} ${data.entity}. ${data.scope}`,results:{title:data.scope,columns:[data.group_label,data.entity==='jobs'?'Jobs':'Invoices',data.metric_label],rows},verification:`Recalculated all ${data.count} unique source records and matched every group and the grand total to the database calculation. ${data.scope}`}
}
