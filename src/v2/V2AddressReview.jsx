import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Check, Loader2, MapPin, Search, Pencil } from 'lucide-react';
import { base44 } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { suggestAddresses, fetchPlace } from '@/lib/googleMaps';
import { addressReviewAvailable, customerAddress, needsAddressReview, reviewedAddressPatch, saveReviewedAddress } from '@/lib/addressReview';
import { assertV2Writable, V2_READ_ONLY } from './guard';

export default function V2AddressReview() {
  if (!addressReviewAvailable(window.location.hostname, import.meta.env.MODE)) return <Navigate to="/v2" replace />;
  return <ReviewList />;
}

function ReviewList() {
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState(new Set());
  const { data: rows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['v2-address-review'],
    queryFn: async () => (await base44.entities.Customer.list('name', 10000)).filter(needsAddressReview),
    staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const visible = rows.filter(row => `${row.name} ${customerAddress(row)}`.toLowerCase().includes(search.trim().toLowerCase()));
  const visibleIds = new Set(visible.map(row => row.id));
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-7">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap gap-4 items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-semibold text-gray-950">Address review</h1>
            <p className="text-sm text-gray-600 mt-1">Compare the current address, choose a Google suggestion, then save that customer.</p>
            <p className="text-xs text-gray-500 mt-2">{import.meta.env.MODE === 'sandbox' ? 'Local sandbox · Saves affect local test data only.' : 'Dev V2 only · Saves update the live customer record and map pin, shared with production.'}</p>
          </div>
          <Button variant="outline" disabled={isFetching} onClick={async () => { const result = await refetch(); if (!result.error) setSaved(new Set()); }}>Refresh list</Button>
        </div>
        <div className="flex flex-wrap gap-3 items-center mb-5">
          <div className="relative flex-1 min-w-56 max-w-md">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input aria-label="Search address review" placeholder="Search name or current address" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white" />
          </div>
          <p className="text-sm text-gray-600" aria-live="polite">{rows.filter(row => !saved.has(row.id)).length} to review · {saved.size} saved this session</p>
        </div>
        {V2_READ_ONLY && <p className="text-sm text-red-700 mb-4">Saving is disabled on this deployment.</p>}
        {isLoading ? <p role="status">Loading addresses…</p> : error ? <p role="alert" className="text-red-700">Could not load addresses. Use Refresh list to try again.</p> : rows.length === 0 ? <p className="p-8 bg-white border rounded-xl text-gray-600">No unresolved customer addresses.</p> : (
          <div className="space-y-3">
            {visible.length === 0 && <p className="p-8 bg-white border rounded-xl text-gray-600">No matching customers.</p>}
            <div className="hidden md:grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)_7.5rem] gap-5 px-4 text-xs font-semibold uppercase tracking-wide text-gray-500"><span>Current address</span><span>Verified address</span><span className="sr-only">Action</span></div>
            {rows.map(row => <div key={`${row.id}-${row.updated_date}`} hidden={!visibleIds.has(row.id)}><ReviewRow customer={row} onSaved={() => setSaved(previous => new Set([...previous, row.id]))} onEdit={() => setSaved(previous => { const next = new Set(previous); next.delete(row.id); return next; })} /></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ customer, onSaved, onEdit }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [baseline, setBaseline] = useState(customer);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [place, setPlace] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current;
    if (place || !focused || text.trim().length < 3) { setSuggestions([]); setLoading(false); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await suggestAddresses(text, { throwOnError: true });
        if (request !== requestId.current) return;
        setSuggestions(list); setActive(-1);
        setError(list.length ? '' : 'No Google matches. Try a street number, road name, and city.');
      } catch (e) { if (request === requestId.current) setError(e.message); }
      finally { if (request === requestId.current) setLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); requestId.current++; };
  }, [text, place, focused]);

  const pick = async (suggestion) => {
    const request = ++requestId.current;
    setSuggestions([]); setLoading(true); setError('');
    try {
      const result = await fetchPlace(suggestion.placeId);
      if (request !== requestId.current) return;
      reviewedAddressPatch(result);
      setPlace(result); setText(result.formatted); setFocused(false);
    } catch (e) { if (request === requestId.current) setError(e.message || 'Could not load that address. Try again.'); }
    finally { if (request === requestId.current) setLoading(false); }
  };
  const save = async () => {
    setSaving(true); setError('');
    try {
      assertV2Writable();
      const updated = await saveReviewedAddress(supabase, baseline, reviewedAddressPatch(place));
      setBaseline(updated);
      setSaved(true); onSaved();
      // Same best-effort wake used by regular customer editing. A paused QB
      // connection retains its queue; it does not prevent address review.
      supabase.functions.invoke('qb-sync', { body: { action: 'run' } }).catch(() => {});
    } catch (e) { setError(e.message || 'Could not save. Please try again.'); }
    finally { setSaving(false); }
  };
  return (
    <section aria-label={`Review ${customer.name}`} className={`grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)_7.5rem] items-center gap-3 md:gap-5 bg-white border rounded-xl px-4 py-3 ${saved ? 'border-green-200' : 'border-gray-200'}`}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-gray-950">{customer.name}</h2>
        <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{customerAddress(baseline) || 'No address recorded'}</p>
      </div>
      <div className="min-w-0">
        <label htmlFor={inputId} className="sr-only">Correct address for {customer.name}</label>
        <div className="relative">
          <Input ref={inputRef} id={inputId} role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls={`${inputId}-suggestions`} aria-activedescendant={active >= 0 ? `${inputId}-${active}` : undefined}
            autoComplete="off" placeholder="Search Google for the correct address…" value={text} disabled={saved || saving} className="pr-9"
            onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.parentElement.contains(e.relatedTarget)) { setFocused(false); setSuggestions([]); } }}
            onChange={e => { requestId.current++; setText(e.target.value); setPlace(null); setSuggestions([]); setError(''); }}
            onKeyDown={e => {
              if (e.key === 'Escape') { setSuggestions([]); setFocused(false); }
              if (!suggestions.length) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % suggestions.length); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? suggestions.length - 1 : i - 1)); }
              if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(suggestions[active]); }
            }} />
          {loading ? <Loader2 aria-label="Loading Google addresses" className="absolute right-3 top-3 h-4 w-4 animate-spin text-gray-400" /> : <MapPin className="absolute right-3 top-3 h-4 w-4 text-gray-400" />}
          {suggestions.length > 0 && <ul id={`${inputId}-suggestions`} role="listbox" className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
            {suggestions.map((suggestion, index) => <li key={suggestion.placeId} id={`${inputId}-${index}`} role="option" aria-selected={index === active}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(suggestion)} className={`w-full px-3 py-3 text-left text-sm hover:bg-gray-100 ${index === active ? 'bg-gray-100' : ''}`}>{suggestion.text}</button>
            </li>)}
            <li role="presentation" className="px-3 py-2 border-t text-right text-xs text-[#5E5E5E] font-normal not-italic whitespace-nowrap" translate="no">Google Maps</li>
          </ul>}
        </div>
        {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2">
        {saved ? <>
          <Button size="sm" disabled className="bg-green-600 text-white disabled:opacity-100 disabled:cursor-default"><Check className="w-4 h-4 mr-1.5" />Done</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-gray-500 hover:text-gray-950" aria-label={`Edit verified address for ${customer.name}`} onClick={() => {
            setSaved(false); setPlace(null); setError(''); setFocused(true); onEdit();
            requestAnimationFrame(() => inputRef.current?.focus());
          }}><Pencil className="w-4 h-4" /></Button>
        </> : <Button size="sm" className="bg-gray-950 hover:bg-gray-800 min-w-20" disabled={!place || saving || V2_READ_ONLY} onClick={save}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save</Button>}
      </div>
    </section>
  );
}
