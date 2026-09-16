import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Camera, Loader2, Check, MapPin, X } from 'lucide-react';
import { base44 } from '@/api/entities';
import { useQueryClient } from '@tanstack/react-query';
import StopsMap from '@/components/admin/StopsMap';
import AddressAutocomplete from '@/components/admin/AddressAutocomplete';
import MapSnapshotEditor from '@/components/admin/MapSnapshotEditor';

// Full-screen viewer for a saved map picture. Portaled to <body> with
// pointer events re-enabled (the open modal dialog disables them outside
// itself); click the backdrop or the X to close.
export function ImageLightbox({ src, onClose }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4"
      style={{ pointerEvents: 'auto' }}
      onClick={onClose}
    >
      <img
        src={src}
        alt="Map picture"
        className="max-w-[94vw] max-h-[90vh] rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close picture"
        className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center text-gray-700 hover:bg-gray-100"
      >
        <X className="w-6 h-6" />
      </button>
    </div>,
    document.body
  );
}

// Left-aligned thumbnail that expands into the lightbox when clicked.
export function MapThumb({ src, className = 'h-24' }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <img
        src={src}
        alt="Map picture — tap to enlarge"
        title="Tap to enlarge"
        onClick={() => setOpen(true)}
        className={`${className} w-auto max-w-full rounded-lg border border-gray-200 cursor-zoom-in hover:opacity-90 block`}
      />
      {open && <ImageLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}

export async function uploadMapImage(blob) {
  const file = new File([blob], `map-${Date.now()}.png`, { type: 'image/png' });
  const { file_url } = await base44.integrations.Core.UploadFile({ file });
  return file_url;
}

// The New Job popup's right column: a large, always-open map. It flies to
// the selected customer's pin (or a new customer's address as it resolves),
// with the snapshot-and-markup tool underneath. The capture asks the server
// for the same view as an image (the live map can't be photographed by the
// browser), then opens the markup editor.
export function JobMapPanel({ pin, title, waitingText, canCapture, onSaveImage, savedNote, initialInstructions = '' }) {
  const mapApiRef = useRef(null);
  const [capturing, setCapturing] = useState(false);
  const [editorImage, setEditorImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const capture = async () => {
    const map = mapApiRef.current?.map;
    if (!map) return;
    setCapturing(true);
    setError('');
    try {
      const c = map.getCenter();
      const { data } = await base44.functions.invoke('map-snapshot', {
        lat: c.lat(), lng: c.lng(),
        zoom: map.getZoom(),
        maptype: map.getMapTypeId() === 'satellite' ? 'satellite' : map.getMapTypeId() === 'hybrid' ? 'hybrid' : 'roadmap',
      });
      if (data?.image) setEditorImage(data.image);
      else setError("Couldn't capture the map — try again.");
    } catch {
      setError("Couldn't capture the map — try again.");
    }
    setCapturing(false);
  };

  const handleSave = async (blob, instructions) => {
    setSaving(true);
    try {
      await onSaveImage(blob, instructions);
      setEditorImage(null);
    } catch {
      setError("Couldn't save the picture — try again.");
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      {title && (
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-gray-500 shrink-0" />
          <p className="text-sm font-medium text-gray-700 truncate">{title}</p>
        </div>
      )}
      <div className="relative flex-1 min-h-0 isolate">
        {/* z-0 creates a stacking context that CONTAINS Google Maps' internal
            z-indexes (up to ~1,000,002) — without it they compete with the
            overlays below and cover them intermittently during zoom. The
            overlays additionally carry translateZ(0): Safari composites the
            map's 3D-accelerated tiles above plain siblings regardless of
            z-index, and promoting the overlays to their own layers is the
            standard WebKit workaround. */}
        <div className="absolute inset-0 z-0">
          <StopsMap
            stops={pin ? [{ ...pin, label: 'Customer' }] : []}
            home={null}
            showRoute={false}
            height="100%"
            mapTypeId="hybrid"
            mapApiRef={mapApiRef}
          />
        </div>
        {!pin && waitingText && (
          <div
            className="absolute inset-x-3 top-3 z-10 bg-white/95 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 shadow-sm pointer-events-none"
            style={{ transform: 'translateZ(0)' }}
          >
            {waitingText}
          </div>
        )}
        {canCapture && (
          <button
            type="button"
            onClick={capture}
            disabled={capturing || !pin}
            title="Snapshot & mark up"
            aria-label="Snapshot & mark up"
            className="absolute top-2.5 right-2.5 z-10 w-11 h-11 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40 transition-colors"
            style={{ transform: 'translateZ(0)' }}
          >
            {capturing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
          </button>
        )}
      </div>
      {(savedNote || error) && (
        <div className="flex items-center gap-2 flex-wrap">
          {savedNote && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-700">
              <Check className="w-3.5 h-3.5" /> {savedNote}
            </span>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
      {editorImage && (
        <MapSnapshotEditor image={editorImage} saving={saving} onSave={handleSave} onClose={() => setEditorImage(null)} initialInstructions={initialInstructions} />
      )}
    </div>
  );
}

// Saves an annotated capture (and any delivery instructions written in the
// editor) onto an existing customer.
export async function saveCustomerMapImage(queryClient, customerId, blob, instructions) {
  const url = await uploadMapImage(blob);
  const update = { map_image_url: url };
  if (instructions) update.delivery_instructions = instructions;
  await base44.entities.Customer.update(customerId, update);
  queryClient.invalidateQueries({ queryKey: ['customers'] });
}

// ---- Inline "new customer" form (left column; the map waits on the right) ----
export function NewCustomerForm({ onCreated, onCancel, onPinChange, mapBlob, mapInstructions = '', onDirty }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState({ name: '', company_name: '', street_address: '', city: '', state: 'OH', zip_code: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => { setFields(prev => ({ ...prev, [k]: v })); onDirty?.(); };

  // Preview of the captured picture (click to enlarge)
  const blobUrl = useMemo(() => (mapBlob ? URL.createObjectURL(mapBlob) : null), [mapBlob]);
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const save = async () => {
    if (!fields.name.trim()) { setError('Name is required.'); return; }
    if (!fields.street_address.trim()) { setError('Address is required.'); return; }
    setSaving(true);
    setError('');
    try {
      // Address fields trigger server-side geocoding automatically on create.
      const created = await base44.entities.Customer.create({
        ...fields,
        country: 'USA',
        ...(mapInstructions ? { delivery_instructions: mapInstructions } : {}),
      });
      if (mapBlob) {
        const url = await uploadMapImage(mapBlob);
        await base44.entities.Customer.update(created.id, { map_image_url: url });
        created.map_image_url = url;
      }
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onCreated(created);
    } catch (e) {
      setError('Could not save the customer — ' + (e.message || 'try again.'));
    }
    setSaving(false);
  };

  return (
    <div className="col-span-1 md:col-span-2 border border-gray-300 rounded-xl p-4 bg-gray-50 space-y-3">
      <p className="text-sm font-semibold text-gray-800">New Customer</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Name <span className="text-red-500">*</span></Label>
          <Input value={fields.name} onChange={(e) => set('name', e.target.value)} placeholder="John Yoder" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Company</Label>
          <Input value={fields.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="Yoder Dairy" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs text-gray-500">Street Address <span className="text-red-500">*</span></Label>
          <AddressAutocomplete
            value={fields.street_address}
            onChange={(v) => set('street_address', v)}
            onResolve={(place) => {
              setFields(prev => ({
                ...prev,
                street_address: place.street || prev.street_address,
                city: place.city || prev.city,
                state: place.state || prev.state,
                zip_code: place.zip || prev.zip_code,
              }));
              onDirty?.();
              if (place.lat != null) onPinChange?.({ lat: place.lat, lng: place.lng });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">City</Label>
          <Input value={fields.city} onChange={(e) => set('city', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">State</Label>
            <Input value={fields.state} onChange={(e) => set('state', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">Zip</Label>
            <Input value={fields.zip_code} onChange={(e) => set('zip_code', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs text-gray-500">Phone</Label>
          <Input value={fields.phone} onChange={(e) => set('phone', e.target.value)} placeholder="330-555-0100" />
        </div>
      </div>

      {blobUrl && (
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Map picture <span className="text-gray-400">(tap to enlarge — saves with the customer)</span></Label>
          <MapThumb src={blobUrl} className="h-20" />
        </div>
      )}
      {mapInstructions && (
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Delivery instructions <span className="text-gray-400">(from the map editor)</span></Label>
          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-white border border-gray-200 rounded-lg px-3 py-2">{mapInstructions}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="button" size="sm" onClick={save} disabled={saving} className="bg-amber-600 hover:bg-amber-700">
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Customer
        </Button>
      </div>
    </div>
  );
}
