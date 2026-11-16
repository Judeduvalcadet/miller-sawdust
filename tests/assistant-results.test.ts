import { parseAssistantResults } from '../supabase/functions/_shared/assistant-results.ts'
Deno.test('accepts bounded table and preserves cell data as text', () => {
 const result = parseAssistantResults({summary:'15 loads delivered.', title:'Deliveries',columns:['Driver','Loads'],rows:[['Joey',4],['Caleb',6],['Rodney',5]]})
 if (result?.results.rows[0][1] !== '4') throw new Error('Missing normalized table')
})
Deno.test('rejects malformed and oversized model tables', () => {
 for (const rows of [[['wrong width']], [[{} ,1]], Array.from({length:101},()=>['Name','1'])]) {
  if(parseAssistantResults({summary:'Summary',title:'Title',columns:['Name','Count'],rows})) throw new Error('Accepted invalid table')
 }
})
