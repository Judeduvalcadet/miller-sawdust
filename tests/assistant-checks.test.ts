import {checkAnswer,conversationSignals,progressLabel} from '../supabase/functions/_shared/assistant-checks.ts'
function assert(value:unknown){if(!value)throw new Error('Assertion failed')}
Deno.test('incorrect totals are warnings; direct records do not prove completeness',()=>{
 const checks=checkAnswer('Results',{title:'Loads',columns:['Driver','Loads'],rows:[['A','2'],['B','3'],['Total','6']]},['query_records'],true,0,true)
 assert(checks.find(c=>c.name==='Total arithmetic')?.status==='warning')
 assert(checks.find(c=>c.name==='Completeness')?.status==='warning')
 assert(checks.find(c=>c.name==='Source match')?.status==='pass')
})
Deno.test('valid totals pass but generated factual claims are not independently verified',()=>{
 const checks=checkAnswer('Results',{title:'Loads',columns:['Driver','Loads'],rows:[['A','2'],['B','3'],['Total','5']]},['query_records'],false,0,false)
 assert(checks.find(c=>c.name==='Total arithmetic')?.status==='pass')
 assert(checks.find(c=>c.name==='Source match')?.status==='not_checked')
})
Deno.test('no source and failed tools cannot pass lookup checks',()=>{
 assert(checkAnswer('Hi',undefined,[],false,0,false)[0].status==='warning')
 assert(checkAnswer('Hi',undefined,['query_records'],false,1,false)[0].status==='warning')
})
Deno.test('signals never infer approval from silence or ordinary followup',()=>{
 assert(conversationSignals('',[{role:'assistant',content:'Answer'}]).length===0)
 assert(conversationSignals('Show tomorrow',[]).length===0)
 assert(conversationSignals('Actually that is wrong',[]).includes('possible_correction'))
 assert(conversationSignals('Show tomorrow?',[{role:'user',content:'Show tomorrow'}]).includes('repeated_question'))
 assert(progressLabel('query_records','customers')==='Finding customers')
})
