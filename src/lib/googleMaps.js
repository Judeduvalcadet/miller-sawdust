// Loads the Google Maps JavaScript API once, using the browser key
// (referrer-locked to our domains; safe to ship in the bundle).
let loadPromise = null;

export function loadGoogleMaps() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.Map) { resolve(window.google.maps); return; }
    const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
    if (!key) { reject(new Error('missing VITE_GOOGLE_MAPS_BROWSER_KEY')); return; }
    window.__onGmapsReady = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__onGmapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return loadPromise;
}

// Places API (New) — autocomplete + place details over REST with the same
// browser key. Biased to the Millersburg service area.
const PLACES_BIAS = { latitude: 40.55, longitude: -81.92 };

export async function suggestAddresses(input) {
  if (!input || input.trim().length < 3) return [];
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY,
    },
    body: JSON.stringify({
      input: input.trim(),
      regionCode: 'US',
      locationBias: { circle: { center: PLACES_BIAS, radius: 50000 } },
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.suggestions || [])
    .map(s => s.placePrediction)
    .filter(Boolean)
    .map(p => ({ placeId: p.placeId, text: p.text?.text || '' }));
}

export async function fetchPlace(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY,
      'X-Goog-FieldMask': 'location,formattedAddress,addressComponents',
    },
  });
  if (!res.ok) return null;
  const p = await res.json();
  const comp = (type, short = false) => {
    const c = (p.addressComponents || []).find(c => c.types?.includes(type));
    return c ? (short ? c.shortText : c.longText) : '';
  };
  const streetNumber = comp('street_number');
  // Google's canonical "Township/County Highway N" is locally "…Road N"
  const route = comp('route')
    .replace(/\bTownship Highway\b/i, 'Township Road')
    .replace(/\bCounty Highway\b/i, 'County Road');
  return {
    street: [streetNumber, route].filter(Boolean).join(' '),
    city: comp('locality') || comp('postal_town') || comp('administrative_area_level_3'),
    state: comp('administrative_area_level_1', true),
    zip: comp('postal_code'),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    formatted: p.formattedAddress || '',
  };
}
