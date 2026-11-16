import { useState } from 'react';
import { assistantRequest } from '@/api/assistantClient';
export default function AssistantFeedback({ message }) {
  const [rating, setRating] = useState(''), [correction, setCorrection] = useState(''), [saved, setSaved] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async value => {
    setBusy(true); setError('');
    try { await assistantRequest({ action:'feedback', run_id:message.run_id, rating:value, correction:value==='incorrect'?correction:'' }); setSaved(value); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="mt-3 border-t pt-2 text-xs whitespace-normal">
    <div className="flex gap-3 text-gray-600">
      <button disabled={busy} onClick={()=>{setRating('helpful');save('helpful');}} className="hover:underline">{saved==='helpful'?'Helpful saved':'Helpful'}</button>
      <button disabled={busy} onClick={()=>setRating('incorrect')} className="hover:underline">{saved==='incorrect'?'Incorrect saved':'Incorrect'}</button>
    </div>
    {rating==='incorrect' && <div className="mt-2 space-y-2"><textarea aria-label="Correction" value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="What should be corrected? (optional)" maxLength={2000} className="w-full border rounded p-2"/><button disabled={busy} onClick={()=>save('incorrect')} className="border rounded px-2 py-1">Save feedback</button><p className="text-gray-500">A correction requires administrator verification before it becomes a rule.</p></div>}
    {error && <p role="alert" className="text-red-700 mt-2">{error}</p>}
    {message.checks?.some(check=>check.status==='warning') && <p className="mt-2 text-amber-800">Some checks need review. See details below.</p>}
    <details className="mt-2 text-gray-500"><summary className="cursor-pointer">Automatic checks</summary>{message.checks?.map((check,i)=><p key={i} className="mt-1"><strong>{check.name}</strong>: {check.status.replaceAll('_',' ')}. {check.detail}</p>)}</details>
  </div>;
}
