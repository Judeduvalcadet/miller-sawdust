import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Search, Plus, Pencil, Factory, MapPin, Warehouse } from 'lucide-react';
import { base44 } from '@/api/entities';
import { cn } from '@/lib/utils';
import AddressAutocomplete from '@/components/admin/AddressAutocomplete';
import { JobMapPanel } from '@/components/admin/CustomerMapSection';

// Directory pages for the two location kinds:
// - Pickup locations: the SUPPLIERS we buy sawdust from (plus our own
//   buildings), with the pickup schedule the route math and the AI use.
// - Drop-off locations: fixed unload points.
// Saving an address re-geocodes automatically (entities.js hook), so new
// records get their map pin without any extra step.

const WEEKDAYS = [
  { value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' }, { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' }, { value: 'fri', label: 'Fri' }, { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
];

export function V2Pickups() {
  return (
    <DirectoryPage
      kind="pickup"
      title="Pickup locations"
      subtitle="Suppliers we buy sawdust from, plus our own buildings."
      entity={base44.entities.PickupLocation}
      queryKey="v2-pickups"
      newLabel="New pickup location"
    />
  );
}

export function V2Dropoffs() {
  return (
    <DirectoryPage
      kind="dropoff"
      title="Drop-off locations"
      subtitle="Fixed unload points."
      entity={base44.entities.DropOffLocation}
      queryKey="v2-dropoffs"
      newLabel="New drop-off location"
    />
  );
}

function DirectoryPage({ kind, title, subtitle, entity, queryKey, newLabel }) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: () => entity.list('name', 2000),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows || [];
    if (!q) return list;
    return list.filter((r) => `${r.name || ''} ${r.address || ''}`.toLowerCase().includes(q));
  }, [rows, search]);

  const selected = (rows || []).find((r) => r.id === selectedId) || null;

  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input placeholder={`Search ${title.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] text-gray-400">{filtered.length}</span>
            <Button
              size="sm" className="h-7 px-2 text-xs bg-gray-950 hover:bg-gray-800"
              onClick={() => { setCreating(true); setSelectedId(null); }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> {newLabel}
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => { setSelectedId(r.id); setCreating(false); }}
              className={cn(
                'w-full text-left px-4 py-2.5 border-b border-gray-50 hover:bg-gray-50',
                selectedId === r.id && !creating && 'bg-gray-100 hover:bg-gray-100'
              )}
            >
              <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                {kind === 'pickup' && r.location_type === 'my_building' && <Warehouse className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                {(r.name || '').trim() || '—'}
              </p>
              <p className="text-xs text-gray-400 truncate">{r.address || ''}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        {creating ? (
          <LocationForm
            kind={kind} entity={entity} queryKey={queryKey} record={null}
            onDone={(created) => { setCreating(false); if (created?.id) setSelectedId(created.id); }}
          />
        ) : selected ? (
          <LocationDetail key={selected.id} kind={kind} record={selected} entity={entity} queryKey={queryKey} subtitle={subtitle} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 p-10">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

function LocationDetail({ kind, record, entity, queryKey, subtitle }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <LocationForm kind={kind} entity={entity} queryKey={queryKey} record={record} onDone={() => setEditing(false)} />
    );
  }

  const scheduleSet = kind === 'pickup' && (record.pickup_days?.length || record.pickups_per_day != null);

  return (
    <div className="p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">{(record.name || '').trim()}</h2>
      <div className="flex flex-col lg:flex-row gap-6 items-stretch max-w-5xl">
        <div className="flex-1 min-w-0">
          <div className="relative bg-white rounded-2xl border border-gray-200 p-5">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="absolute top-3 right-3 h-7 px-2.5 text-xs">
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
            </Button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Name" value={record.name} />
              {kind === 'pickup' && (
                <Field label="Type" value={record.location_type === 'my_building' ? 'Our building' : 'Supplier'} />
              )}
              {kind === 'pickup' && <Field label="Phone" value={record.phone} />}
              <div className="sm:col-span-2"><Field label="Address" value={record.address} /></div>
              {kind === 'dropoff' && <div className="sm:col-span-2"><Field label="Notes" value={record.notes} pre /></div>}
            </div>

            {kind === 'pickup' && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Pickup schedule</p>
                {scheduleSet ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {(record.pickup_days || []).map((d) => (
                        <span key={d} className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-2.5 py-1 text-xs font-medium capitalize">
                          {WEEKDAYS.find((w) => w.value === d)?.label || d}
                        </span>
                      ))}
                    </div>
                    {record.pickups_per_day != null && (
                      <p className="text-sm text-gray-700">{record.pickups_per_day} load{record.pickups_per_day !== 1 ? 's' : ''} per pickup day</p>
                    )}
                    {record.pickup_schedule_notes && (
                      <p className="text-sm text-gray-500 whitespace-pre-wrap">{record.pickup_schedule_notes}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">Not entered yet.</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="w-full lg:w-[44%] shrink-0 self-start">
          <div className="h-[300px] lg:h-[52vh] lg:min-h-[380px]">
            <JobMapPanel
              pin={record.latitude != null ? { lat: record.latitude, lng: record.longitude } : null}
              title=""
              waitingText="This location's address isn't map-verified yet."
              canCapture={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LocationForm({ kind, entity, queryKey, record, onDone }) {
  const queryClient = useQueryClient();
  const isNew = !record;
  const [form, setForm] = useState({
    name: record?.name || '',
    phone: record?.phone || '',
    address: record?.address || '',
    notes: record?.notes || '',
    location_type: record?.location_type || 'supplier',
    pickup_days: record?.pickup_days || [],
    pickups_per_day: record?.pickups_per_day != null ? String(record.pickups_per_day) : '',
    pickup_schedule_notes: record?.pickup_schedule_notes || '',
  });
  const [pendingPin, setPendingPin] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const payload = () => {
    const base = { name: form.name.trim(), address: form.address.trim() };
    if (kind === 'dropoff') return { ...base, notes: form.notes.trim() || null };
    return {
      ...base,
      phone: form.phone.trim() || null,
      location_type: form.location_type,
      pickup_days: form.pickup_days.length ? form.pickup_days : null,
      pickups_per_day: form.pickups_per_day === '' ? null : (parseInt(form.pickups_per_day) || null),
      pickup_schedule_notes: form.pickup_schedule_notes.trim() || null,
      ...(isNew ? { assigned_drivers: [] } : {}),
    };
  };

  const save = useMutation({
    mutationFn: () => isNew ? entity.create(payload()) : entity.update(record.id, payload()),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      onDone(created);
    },
  });

  const toggleDay = (d) => set('pickup_days',
    form.pickup_days.includes(d) ? form.pickup_days.filter((x) => x !== d) : [...form.pickup_days, d]);

  return (
    <div className="p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">
        {isNew ? (kind === 'pickup' ? 'New pickup location' : 'New drop-off location') : `Edit ${record.name}`}
      </h2>
      <div className="flex flex-col lg:flex-row gap-6 items-stretch max-w-5xl">
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-gray-200 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className={kind === 'pickup' ? 'space-y-1.5' : 'col-span-2 space-y-1.5'}>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            {kind === 'pickup' && (
              <div className="space-y-1.5">
                <Label>Type</Label>
                <div className="flex gap-1.5">
                  {[['supplier', 'Supplier', Factory], ['my_building', 'Our building', Warehouse]].map(([v, l, Icon]) => (
                    <button
                      key={v} type="button"
                      onClick={() => set('location_type', v)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
                        form.location_type === v
                          ? 'bg-gray-950 text-white border-gray-950'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" /> {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="col-span-2 space-y-1.5">
              <Label>Address</Label>
              <AddressAutocomplete
                value={form.address}
                onChange={(v) => set('address', v)}
                onResolve={(place) => {
                  const full = [place.street, place.city, [place.state, place.zip].filter(Boolean).join(' ')]
                    .filter(Boolean).join(', ');
                  set('address', full || form.address);
                  if (place.lat != null) setPendingPin({ lat: place.lat, lng: place.lng });
                }}
              />
              <p className="text-[11px] text-gray-400">Pick a suggestion and the pin drops on the map — the address is verified on save.</p>
            </div>
            {kind === 'pickup' && (
              <div className="col-span-2 space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
            )}
            {kind === 'dropoff' && (
              <div className="col-span-2 space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </div>
            )}
          </div>

          {kind === 'pickup' && (
            <div className="mt-5 pt-4 border-t border-gray-100 space-y-3">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Pickup schedule <span className="normal-case font-normal">(optional — the route planner and assistant use this)</span></p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map(({ value, label }) => (
                  <button
                    key={value} type="button"
                    onClick={() => toggleDay(value)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      form.pickup_days.includes(value)
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-gray-500 whitespace-nowrap">Loads per pickup day</Label>
                <Input
                  type="number" min="1"
                  value={form.pickups_per_day}
                  onChange={(e) => set('pickups_per_day', e.target.value)}
                  className="h-8 w-20 text-sm"
                />
              </div>
              <Textarea
                rows={2}
                placeholder="Schedule notes (e.g. call first, gate closes at 4)…"
                value={form.pickup_schedule_notes}
                onChange={(e) => set('pickup_schedule_notes', e.target.value)}
              />
            </div>
          )}

          <div className="flex gap-2 mt-5">
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.name.trim()}
              className="bg-gray-950 hover:bg-gray-800"
            >
              {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isNew ? 'Create' : 'Save'}
            </Button>
            <Button variant="outline" onClick={() => onDone(null)}>Cancel</Button>
          </div>
        </div>

        <div className="w-full lg:w-[44%] shrink-0 self-start">
          <div className="h-[320px] lg:h-[54vh] lg:min-h-[400px]">
            <JobMapPanel
              pin={pendingPin || (record?.latitude != null ? { lat: record.latitude, lng: record.longitude } : null)}
              title={[form.name, form.address].filter(Boolean).join(' — ')}
              waitingText="Start typing the address and pick a suggestion — the pin drops here."
              canCapture={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, pre }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      {value
        ? <p className={cn('text-gray-900 mt-0.5', pre && 'whitespace-pre-wrap')}>{value}</p>
        : <p className="text-gray-400 mt-0.5 italic">—</p>}
    </div>
  );
}
