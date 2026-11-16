import { useEffect, useState } from 'react';
import { assistantRequest } from '@/api/assistantClient';
function ReviewItem({ item, refresh }) {
  const [rule,setRule]=useState(''),[notes,setNotes]=useState(''),[kind,setKind]=useState('presentation'),[verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(decision) { setBusy(true);setError('');try { await assistantRequest({action:'review',feedback_id:item.id,expected_updated_at:item.updated_at,decision,rule_text:rule,kind,verification_notes:notes,verified});await refresh(); } catch(e){setError(e.message);}finally{setBusy(false);} }
  return <article className="border rounded-lg p-3 space-y-2 text-sm bg-white">
    <p className="font-semibold">{item.rating} · {item.status}</p><p>{item.run?.prompt}</p><p className="text-gray-600 whitespace-pre-wrap">{item.run?.reply}</p>
    {item.run?.results && <div className="overflow-auto"><table className="text-xs"><thead><tr>{item.run.results.columns.map((c,i)=><th key={i} className="p-2">{c}</th>)}</tr></thead><tbody>{item.run.results.rows.map((row,i)=><tr key={i}>{row.map((c,j)=><td key={j} className="p-2 border">{String(c)}</td>)}</tr>)}</tbody></table></div>}
    <p>Correction: {item.correction || 'None provided'}</p>
    <details><summary>Checks and signals</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({checks:item.run?.checks,signals:item.run?.signals},null,2)}</pre></details>
    {item.status==='pending' && <>
      {item.rating==='incorrect' && <><select aria-label="Rule category" value={kind} onChange={e=>setKind(e.target.value)} className="border rounded p-2"><option value="presentation">Presentation</option><option value="terminology">Terminology</option><option value="lookup">Lookup guidance</option></select><textarea aria-label="Reusable rule" placeholder="Reusable rule, never a remembered balance or address" value={rule} onChange={e=>setRule(e.target.value)} maxLength={1000} className="w-full border rounded p-2"/></>}
      <textarea aria-label="Verification evidence" placeholder="Verification evidence: what source did you check and what did it establish?" value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000} className="w-full border rounded p-2"/>
      {item.rating==='incorrect' && <label className="flex gap-2"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>I verified this reusable correction against its source.</label>}
      <div className="flex gap-2 flex-wrap">{item.rating==='incorrect' && <button disabled={busy||!verified||notes.trim().length<20||rule.trim().length<10} onClick={()=>submit('approve_rule')} className="border rounded p-2 disabled:opacity-40">Verify and save rule</button>}<button disabled={busy} onClick={()=>submit('resolve')} className="border rounded p-2">Resolve without rule</button><button disabled={busy} onClick={()=>submit('reject')} className="border rounded p-2">Reject</button></div>
    </>}{error&&<p role="alert" className="text-red-700">{error}</p>}
  </article>;
}
export default function AssistantReview() {
  const [data,setData]=useState(null),[error,setError]=useState('');
  async function refresh(){try{const {data}=await assistantRequest({action:'reviews'});setData(data);}catch(e){setError(e.message);}}
  useEffect(()=>{refresh();},[]);
  return <div className="space-y-4 overflow-auto p-1"><p className="text-sm text-gray-600">Dev only. Votes and silence never approve rules. Verify source evidence before saving a reusable rule. Live facts are always fetched again.</p>{error&&<p role="alert">{error}</p>}{!data&&<p>Loading reviews...</p>}{data?.feedback.length===0&&<p>No feedback yet.</p>}{data?.feedback.map(item=><ReviewItem key={item.id} item={item} refresh={refresh}/>)}<h3 className="font-semibold">Lasting rules</h3>{data?.rules.map(rule=><div key={rule.id} className="border rounded p-3 text-sm"><p>{rule.rule_text}</p><p className="text-gray-500">{rule.verification_notes}</p>{rule.active?<button className="underline mt-2" onClick={async()=>{try{await assistantRequest({action:'disable_rule',rule_id:rule.id});await refresh();}catch(e){setError(e.message);}}}>Disable rule</button>:<p>Disabled</p>}</div>)}<details><summary>Recent automatic checks</summary>{data?.runs.map(run=><div key={run.id} className="border-b py-2 text-xs"><p>{run.prompt}</p><pre className="whitespace-pre-wrap">{JSON.stringify({checks:run.checks,signals:run.signals},null,2)}</pre></div>)}</details></div>;
}
