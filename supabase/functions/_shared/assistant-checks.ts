import type { AssistantResults } from './assistant-results.ts'
export interface Check { name: string; status: 'pass'|'warning'|'not_checked'; detail: string }
export function checkAnswer(reply: string, results: AssistantResults | undefined, tools: string[], direct: boolean, toolErrors: number, partial: boolean): Check[] {
  tools = tools.filter(tool => !['describe_data','show_records','present_results'].includes(tool))
  const checks: Check[] = [
    {name:'Data lookup',status:tools.length > 0 && toolErrors === 0 ? 'pass' : 'warning',detail:toolErrors ? `${toolErrors} lookup errors occurred.` : tools.length ? 'The answer used data tools.' : 'No fresh data lookup was recorded.'},
    {name:'Source match',status:direct ? 'pass' : 'not_checked',detail:direct ? 'Table cells were rendered directly from returned records.' : 'The generated answer has not been independently verified against every source value.'},
    {name:'Completeness',status:partial ? 'warning' : 'not_checked',detail:partial ? 'The result is paged; it is not the entire matching dataset.' : 'No paging limit was reported. Interpretation still needs review.'},
  ]
  if (!reply.trim()) checks.push({name:'Response',status:'warning',detail:'Empty response.'})
  if (results) {
    const shape = results.rows.every(row => row.length === results.columns.length)
    checks.push({name:'Table structure',status:shape?'pass':'warning',detail:shape?'All rows match the table columns.':'Some rows do not match the columns.'})
    const totals = results.rows.filter(row => /^(grand\s+)?total$/i.test(row[0]?.trim()))
    const body = results.rows.filter(row => !totals.includes(row))
    const numeric = (value: string) => /^\s*[$£€]?\s*-?[\d,]+(?:\.\d+)?\s*(?:loads?|yds|yards?)?\s*$/i.test(value) ? Number(value.replace(/[$£€,]|loads?|yds|yards?/gi,'').trim()) : null
    let compared=0, bad=0
    for (const total of totals) for (let i=1;i<total.length;i++) {
      const expected=numeric(total[i]); const values=body.map(row=>numeric(row[i]))
      if(expected===null || !values.length || values.some(v=>v===null)) continue
      compared++; if(Math.abs(values.reduce<number>((a,v)=>a+(v??0),0)-expected)>0.011) bad++
    }
    checks.push({name:'Total arithmetic',status:bad?'warning':compared?'pass':'not_checked',detail:bad?'A displayed total differs from its numeric rows.':compared?'Displayed totals match the numeric rows.':'No comparable numeric total was present.'})
  }
  return checks
}
export function conversationSignals(message: string, prior: {role:string;content:string}[]) {
  const signals: string[]=[]
  const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'')
  if(prior.filter(m=>m.role==='user').slice(-3).some(m=>normalize(m.content)===normalize(message))) signals.push('repeated_question')
  if(/\b(incorrect|wrong|not what i|that is not|that's not|you missed|actually|correction)\b/i.test(message)) signals.push('possible_correction')
  return signals // No inference from silence, departure, or a missing vote.
}
export function progressLabel(tool: string, entity?: string) {
  if(tool==='query_records') return ({customers:'Finding customers',jobs:'Fetching jobs',invoices:'Finding invoices',items:'Checking items',customer_item_prices:'Checking prices',pickup_locations:'Finding locations',drop_off_locations:'Finding addresses',messaging_messages:'Fetching messages'} as Record<string,string>)[entity || ''] || 'Fetching records'
  return ({describe_data:'Checking available data',get_day_jobs:'Fetching jobs',get_drivers:'Finding drivers',find_customer:'Finding customers',check_route:'Checking route times',get_supplier_pickups:'Counting pickups',get_pickup_locations:'Finding locations',present_results:'Preparing results',show_records:'Preparing results'} as Record<string,string>)[tool] || 'Checking information'
}
