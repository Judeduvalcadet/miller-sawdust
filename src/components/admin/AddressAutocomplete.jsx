import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin } from 'lucide-react';
import { suggestAddresses, fetchPlace } from '@/lib/googleMaps';

// Street-address input with live Google suggestions. Selecting one calls
// onResolve({ street, city, state, zip, lat, lng, formatted }).
export default function AddressAutocomplete({ value, onChange, onResolve, placeholder = 'Start typing the address...' }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const handleChange = (text) => {
    onChange(text);
    clearTimeout(debounceRef.current);
    if (text.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      const list = await suggestAddresses(text);
      setSuggestions(list);
      setOpen(list.length > 0);
    }, 300);
  };

  const pick = async (s) => {
    setOpen(false);
    setSuggestions([]);
    const place = await fetchPlace(s.placeId);
    if (place) {
      onChange(place.street || s.text);
      onResolve?.(place);
    } else {
      onChange(s.text);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              onClick={() => pick(s)}
              className="w-full flex items-start gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
            >
              <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <span className="text-gray-800">{s.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
