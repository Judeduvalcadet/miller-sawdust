import React, { useState, useEffect, useRef } from 'react';
import { base44 } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MapPin, Phone, Calendar, Package, Truck, Warehouse,
  Navigation, CheckCircle, FileText, ArrowLeft,
  DollarSign, Loader2, Check, AlertCircle, Circle, ChevronDown, ChevronUp, Info, StickyNote
} from "lucide-react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// Initialize loads array from job data
function initLoads(job) {
  const qty = parseInt(job.quantity) || 1;
  const existing = Array.isArray(job.loads) ? job.loads : [];
  return Array.from({ length: qty }, (_, i) => {
    const loadNum = i + 1;
    const found = existing.find(l => l.load_number === loadNum);
    if (found) {
      const autoCompleted = !!(found.pickup_location_name && found.yards_collected);
      return { ...found, completed: found.completed || autoCompleted };
    }
    // Pre-populate load 1 yards from dispatcher-entered pickup_yards
    const preFilledYards = (loadNum === 1 && job.pickup_yards) ? String(job.pickup_yards) : '';
    return { load_number: loadNum, yards_collected: preFilledYards, pickup_location_name: '', completed: false };
  });
}

// Per-load row for all pickup jobs
function PickupLoadRow({ load, onChange, disabled, yardPresets, truckType }) {
  const [error, setError] = useState('');
  const [yardsMode, setYardsMode] = useState(() => {
    // If pre-filled by dispatcher, start in preset mode showing that value
    return 'preset';
  });
  const presets = (yardPresets && truckType) ? (yardPresets[truckType] || []) : [];

  const handleComplete = () => {
    if (!load.yards_collected || parseFloat(load.yards_collected) <= 0) {
      setError('Yards collected is required before completing this load.');
      return;
    }
    setError('');
    onChange({ ...load, completed: true });
  };

  const handleUndo = () => {
    onChange({ ...load, completed: false });
  };

  return (
    <div className={cn(
      "rounded-lg border-2 p-4 transition-all",
      load.completed ? "bg-green-50 border-green-400" : "bg-white border-gray-200"
    )}>
      <div className="flex items-center justify-between mb-3">
        <span className={cn("font-semibold text-sm", load.completed ? "text-green-700" : "text-gray-700")}>
          Load {load.load_number}
        </span>
        {load.completed ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600 font-medium">Completed</span>
            {!disabled && (
              <button onClick={handleUndo} className="text-xs text-gray-400 underline">Undo</button>
            )}
            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
        ) : (
          <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center">
            <Circle className="w-3.5 h-3.5 text-gray-400" />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-xs text-gray-500 mb-1">Yards Collected (yds)</Label>
          {yardsMode === 'preset' ? (
            <Select
              value={load.yards_collected !== '' ? String(load.yards_collected) : ''}
              onValueChange={(v) => {
                setError('');
                if (v === 'custom') {
                  setYardsMode('custom');
                  onChange({ ...load, yards_collected: '' });
                } else {
                  onChange({ ...load, yards_collected: v });
                }
              }}
              disabled={disabled || load.completed}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="Select yards..." /></SelectTrigger>
              <SelectContent>
                {presets.map(y => (
                  <SelectItem key={y} value={String(y)}>{y} yds</SelectItem>
                ))}
                <SelectItem value="custom">Custom...</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="e.g. 45 yds"
                value={load.yards_collected}
                onChange={(e) => { setError(''); onChange({ ...load, yards_collected: e.target.value }); }}
                disabled={disabled || load.completed}
                className="h-9"
                autoFocus
              />
              <Button type="button" variant="outline" size="sm" className="h-9 px-2 shrink-0"
                onClick={() => { setYardsMode('preset'); onChange({ ...load, yards_collected: '' }); }}
              >↩</Button>
            </div>
          )}
        </div>
        {error && (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded p-2 text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}
        {!load.completed && !disabled && (
          <Button
            size="sm"
            onClick={handleComplete}
            className="w-full bg-green-600 hover:bg-green-700 text-white"
          >
            <Check className="w-3.5 h-3.5 mr-1.5" />
            Mark Load Complete
          </Button>
        )}
      </div>
    </div>
  );
}

// Per-load row for Josh (delivery jobs)
function JoshLoadRow({ load, initialLoad, onChange, disabled, joshPickupLocations, deYellow = false, yardOptions = [] }) {
  const [error, setError] = useState('');
  const locationPreFilled = !!initialLoad?.pickup_location_name;
  const yardsPreFilled = !!initialLoad?.yards_collected;

  const handleComplete = () => {
    if (!load.pickup_location_name || !load.yards_collected || parseFloat(load.yards_collected) <= 0) {
      setError('Pickup location and yards collected are required before completing this load.');
      return;
    }
    setError('');
    onChange({ ...load, completed: true });
  };

  const handleUndo = () => {
    onChange({ ...load, completed: false });
  };

  return (
    <div className={cn(
      "rounded-lg border-2 p-4 transition-all",
      load.completed ? "bg-green-50 border-green-400" : "bg-white border-gray-200"
    )}>
      <div className="flex items-center justify-between mb-3">
        <span className={cn("font-semibold text-sm", load.completed ? "text-green-700" : "text-gray-700")}>
          Load {load.load_number}
        </span>
        {load.completed ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600 font-medium">Completed</span>
            {!disabled && (
              <button onClick={handleUndo} className="text-xs text-gray-400 underline">Undo</button>
            )}
            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
        ) : (
          <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center">
            <Circle className="w-3.5 h-3.5 text-gray-400" />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <Label className={cn("text-xs font-medium mb-1", deYellow ? "text-gray-500" : "text-amber-700")}>
            Pickup Location {locationPreFilled ? <span className="text-green-600 font-normal">(pre-filled)</span> : <span className="text-red-500">*</span>}
          </Label>
          <SearchableSelect
            value={load.pickup_location_name}
            onValueChange={(v) => { setError(''); onChange({ ...load, pickup_location_name: v }); }}
            options={joshPickupLocations.map(l => ({ value: l.name, label: l.name }))}
            placeholder="Search pickup location..."
            disabled={disabled || load.completed}
          />
        </div>
        <div>
          <Label className={cn("text-xs font-medium mb-1", deYellow ? "text-gray-500" : "text-amber-700")}>
            Yards Collected (yds) {yardsPreFilled ? <span className="text-green-600 font-normal">(pre-filled)</span> : <span className="text-red-500">*</span>}
          </Label>
          {yardOptions.length > 0 ? (
            <div className="flex gap-2">
              {yardOptions.map((o) => {
                const selected = String(load.yards_collected) === String(o.yards);
                return (
                  <button
                    key={o.itemId}
                    type="button"
                    disabled={disabled || load.completed}
                    onClick={() => {
                      setError('');
                      onChange({ ...load, yards_collected: String(o.yards), item_id: o.itemId });
                    }}
                    className={cn(
                      "h-11 px-5 rounded-lg bg-white text-sm font-semibold transition-colors",
                      selected
                        ? "border-[3px] border-gray-700 text-gray-900"
                        : "border border-gray-300 text-gray-700",
                      (disabled || load.completed) && !selected && "opacity-50"
                    )}
                  >
                    {o.yards} yds
                  </button>
                );
              })}
            </div>
          ) : yardsPreFilled && load.completed ? (
            <div className="h-9 flex items-center px-3 rounded-md border border-green-200 bg-green-50 text-sm text-green-800 font-medium">
              {load.yards_collected} yds
            </div>
          ) : (
          <Input
            type="number"
            placeholder="e.g. 45 yds"
            value={load.yards_collected}
            onChange={(e) => { setError(''); onChange({ ...load, yards_collected: e.target.value }); }}
            disabled={disabled || load.completed}
            className="h-9"
          />
          )}
        </div>
        {error && (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded p-2 text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}
        {!load.completed && !disabled && (
          <Button
            size="sm"
            onClick={handleComplete}
            className="w-full bg-green-600 hover:bg-green-700 text-white"
          >
            <Check className="w-3.5 h-3.5 mr-1.5" />
            Mark Load Complete
          </Button>
        )}
      </div>
    </div>
  );
}

export default function JobDetail({ job, onBack, onUpdate, isUpdating, pickupLocations = [], driverName = '', customer = null, deYellow = false, items = [] }) {
  const [driverNotes, setDriverNotes] = useState(job.driver_notes || '');
  const [paymentCollected, setPaymentCollected] = useState(job.payment_collected || false);
  const [loads, setLoads] = useState(() => initLoads(job));
  const initialLoads = React.useRef(initLoads(job)).current;
  const [yardPresets, setYardPresets] = useState({});

  // Notes indicator + auto-scroll/pulse on every open of a job with notes.
  // dispatcher_notes is dispatch → driver communication and takes priority for
  // scroll target; driver-only notes still trigger the indicator + animation.
  const hasDispatcherNotes = !!(job.dispatcher_notes && job.dispatcher_notes.trim());
  const hasDriverNotes = !!(driverNotes && driverNotes.trim());
  const hasNotes = hasDispatcherNotes || hasDriverNotes;
  const dispatcherNotesRef = useRef(null);
  const driverNotesRef = useRef(null);
  const [pulseNotes, setPulseNotes] = useState(false);

  const focusNotes = () => {
    const target = hasDispatcherNotes ? dispatcherNotesRef.current : driverNotesRef.current;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulseNotes(false);
    // next tick so the class re-applies and the animation restarts on repeat clicks
    requestAnimationFrame(() => setPulseNotes(true));
  };

  useEffect(() => {
    if (!hasNotes) return;
    // delay slightly so layout has settled (cards above are still mounting)
    const t = setTimeout(() => focusNotes(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  useEffect(() => {
    if (!pulseNotes) return;
    // total animation duration is 0.9s × 2 iterations = 1.8s
    const t = setTimeout(() => setPulseNotes(false), 1900);
    return () => clearTimeout(t);
  }, [pulseNotes]);

  useEffect(() => {
    if (job.job_type === 'pickup') {
      base44.entities.Settings.list().then(results => {
        if (results.length > 0 && results[0].truck_yard_presets) {
          setYardPresets(results[0].truck_yard_presets);
        }
      });
    }
  }, []);

  const isCompleted = job.status === 'completed';
  const isPending = job.status === 'pending' || job.status === 'in_progress';

  // Determine driver type
  const isPickupJob = job.job_type === 'pickup';
  const isJoshDelivery = job.job_type === 'delivery' && job.truck_type === 'spreader';
  const isLoadBased = isPickupJob || isJoshDelivery;

  // Spreader-truck delivery jobs: driver picks any pickup location per load
  // (previously filtered to the legacy 'josh' assigned_drivers subset).
  const joshPickupLocations = [...pickupLocations].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Spreader yardage selectors: an item-linked load offers every catalog
  // item in the same family (spreader + same config label); choosing one
  // swaps the load's invoice item so billing always matches QuickBooks.
  const yardOptionsFor = (load) => {
    if (!items.length || !load.item_id) return [];
    const it = items.find(x => x.id === load.item_id);
    if (!it || it.truck_type !== 'spreader') return [];
    const label = it.display_label || it.name;
    return items
      .filter(x => x.active && x.is_load_item && x.truck_type === 'spreader' && (x.display_label || x.name) === label && x.yards != null)
      .sort((a, b) => b.yards - a.yards)
      .map(x => ({ yards: Number(x.yards), itemId: x.id }));
  };

  const completedLoadsCount = loads.filter(l => l.completed).length;
  const allLoadsCompleted = completedLoadsCount === loads.length && loads.length > 0;

  // For non-load-based jobs (regular delivery driver): simple load toggle
  const [simpleCompletedLoads, setSimpleCompletedLoads] = useState([]);
  const allSimpleLoadsCompleted = simpleCompletedLoads.length === (parseInt(job.quantity) || 1);

  const handleUpdateLoad = (index, updatedLoad) => {
    setLoads(prev => {
      const next = [...prev];
      next[index] = updatedLoad;
      return next;
    });
  };

  const handleGetDirections = () => {
    const encodedAddress = encodeURIComponent(job.address);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `maps://maps.apple.com/?daddr=${encodedAddress}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`;
    window.open(url, '_blank');
  };

  const handleCall = () => {
    if (job.phone) window.location.href = `tel:${job.phone}`;
  };

  // Build the audit-field delta for payment_collected transitions.
  // - off → on: stamp who marked it and when
  // - on  → off: clear the stamp
  // - unchanged: no-op
  const paymentAuditDelta = () => {
    if (paymentCollected && !job.payment_collected) {
      return {
        payment_marked_by: driverName || 'Driver',
        payment_marked_at: new Date().toISOString(),
      };
    }
    if (!paymentCollected && job.payment_collected) {
      return {
        payment_marked_by: null,
        payment_marked_at: null,
      };
    }
    return {};
  };

  const handleMarkCompleted = () => {
    const normalizedLoads = loads.map(l => ({
      ...l,
      yards_collected: l.yards_collected ? parseFloat(l.yards_collected) : null
    }));
    const totalYards = normalizedLoads.reduce((sum, l) => sum + (l.yards_collected || 0), 0);

    const updates = {
      status: 'completed',
      completed_at: new Date().toISOString(),
      payment_collected: paymentCollected,
      driver_notes: driverNotes,
      ...paymentAuditDelta(),
    };

    if (isLoadBased) {
      updates.loads = normalizedLoads;
      if (isPickupJob) updates.yards_collected = totalYards;
      if (isJoshDelivery && items.length) {
        updates.delivery_yards = totalYards || null;
        updates.item_id = normalizedLoads.find(l => l.item_id)?.item_id || job.item_id || null;
      }
    }

    onUpdate(updates).then(() => onBack());
  };

  const handleSaveProgress = () => {
    const normalizedLoads = loads.map(l => ({
      ...l,
      yards_collected: l.yards_collected ? parseFloat(l.yards_collected) : null
    }));
    const totalYards = normalizedLoads.reduce((sum, l) => sum + (l.yards_collected || 0), 0);

    const updates = {
      driver_notes: driverNotes,
      payment_collected: paymentCollected,
      status: completedLoadsCount > 0 && !allLoadsCompleted ? 'in_progress' : job.status,
      ...paymentAuditDelta(),
    };

    if (isLoadBased) {
      updates.loads = normalizedLoads;
      if (isPickupJob) updates.yards_collected = totalYards;
    }

    onUpdate(updates);
  };

  const toggleSimpleLoad = (loadNum) => {
    setSimpleCompletedLoads(prev =>
      prev.includes(loadNum) ? prev.filter(n => n !== loadNum) : [...prev, loadNum]
    );
  };

  const loadsReady = isLoadBased ? allLoadsCompleted : (job.quantity <= 1 || allSimpleLoadsCompleted);
  const isDelivery = job.job_type === 'delivery';
  const invoiceSet = job.invoice_sent === 'yes' || job.invoice_sent === 'no';
  const [deliveryInstructionsOpen, setDeliveryInstructionsOpen] = useState(false);
  const hasDeliveryInstructions = isDelivery && customer && (customer.delivery_instructions || customer.map_image_url);
  const canCompleteJob = loadsReady && (!isDelivery || invoiceSet);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className={cn(
        "sticky top-0 z-10 px-4 py-3 flex items-center gap-3",
        isPending ? "bg-red-50" : "bg-green-50"
      )}>
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-xs font-semibold uppercase",
              job.job_type === 'pickup' ? "text-amber-700" : "text-blue-700"
            )}>
              {job.job_type}
            </span>
            <Badge className={cn(
              (job.status === 'pending' || job.status === 'in_progress') && "bg-red-200 text-red-800",
              job.status === 'completed' && "bg-green-200 text-green-800"
            )}>
              {job.status === 'in_progress' ? 'In Progress' : job.status}
            </Badge>
          </div>
          <h1 className="font-bold text-lg text-gray-900">{job.location_name}</h1>
        </div>
        {hasNotes && (
          <button
            type="button"
            onClick={focusNotes}
            className="inline-flex items-center gap-1 bg-black text-white text-xs font-semibold px-2.5 py-1.5 rounded-md hover:bg-gray-800 active:scale-95 transition-all shrink-0"
            aria-label="Scroll to notes"
          >
            <StickyNote className="w-3.5 h-3.5" />
            NOTE
          </button>
        )}
        <div className={cn(
          "p-2 rounded-lg",
          job.job_type === 'pickup' ? "bg-amber-100" : "bg-blue-100"
        )}>
          {job.job_type === 'pickup' ? (
            <Package className="w-6 h-6 text-amber-700" />
          ) : (
            <Truck className="w-6 h-6 text-blue-700" />
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-14 text-base font-medium" onClick={handleGetDirections}>
            <Navigation className="w-5 h-5 mr-2 text-blue-600" />
            Get Directions
          </Button>
          <Button variant="outline" className="h-14 text-base font-medium" onClick={handleCall} disabled={!job.phone}>
            <Phone className="w-5 h-5 mr-2 text-green-600" />
            Call
          </Button>
        </div>

        {/* Job Info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Job Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm text-gray-500">{isPickupJob ? 'Pickup Location' : 'Address'}</p>
                <p className="font-medium">{job.location_name || job.address}</p>
                {job.address && job.location_name && <p className="text-sm text-gray-500">{job.address}</p>}
              </div>
            </div>
            {isPickupJob && job.dropoff_location_name && (
              <div className="flex items-start gap-3">
                <MapPin className={cn("w-5 h-5 mt-0.5", deYellow ? "text-gray-400" : "text-amber-500")} />
                <div>
                  <p className="text-sm text-gray-500">Drop-Off Location</p>
                  <p className="font-medium">{job.dropoff_location_name}</p>
                </div>
              </div>
            )}
            {job.pickup_location_id && (() => {
              const loc = pickupLocations.find(l => l.id === job.pickup_location_id);
              return loc ? (
                <div className="flex items-start gap-3">
                  <Warehouse className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Pickup Location</p>
                    <p className="font-medium">{loc.name}</p>
                  </div>
                </div>
              ) : null;
            })()}
            {job.phone && (
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-500">Phone</p>
                  <p className="font-medium">{job.phone}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm text-gray-500">Scheduled Date</p>
                <p className="font-medium">{format(new Date(job.scheduled_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Truck className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm text-gray-500">Quantity</p>
                <p className="font-medium text-lg">
                  {deYellow
                    ? `${job.quantity || 1} load${(job.quantity || 1) !== 1 ? 's' : ''}`
                    : (job.load_configuration || `${job.quantity} truckload${job.quantity !== 1 ? 's' : ''}`)}
                </p>
              </div>
            </div>
            {/* Yards + Load Configuration for regular delivery jobs */}
            {job.job_type === 'delivery' && (job.delivery_yards || job.load_configuration) && (
              <div className={cn("rounded-lg border p-3 flex items-start gap-3", deYellow ? "bg-gray-50 border-gray-200" : "bg-amber-50 border-amber-200")}>
                <Package className={cn("w-5 h-5 mt-0.5 shrink-0", deYellow ? "text-gray-500" : "text-amber-600")} />
                <div>
                  {deYellow && loads.length > 0 ? (
                    <>
                      <p className="font-bold text-base leading-tight text-gray-900">
                        {loads.map((l, i) => `L${l.load_number || i + 1}: ${l.yards_collected || '—'}`).join(' · ')} yds
                      </p>
                      <p className="font-medium text-sm mt-0.5 text-gray-600">
                        {loads.map((l, i) => `L${l.load_number || i + 1}: ${l.load_configuration || '—'}`).join(' · ')}
                      </p>
                    </>
                  ) : (
                    <>
                      {job.delivery_yards && (
                        <p className={cn("font-bold text-lg leading-tight", deYellow ? "text-gray-900" : "text-amber-900")}>{job.delivery_yards} yds</p>
                      )}
                      {job.load_configuration && (
                        <p className={cn("font-medium text-sm mt-0.5", deYellow ? "text-gray-600" : "text-amber-800")}>{job.load_configuration}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delivery Instructions Widget */}
        {hasDeliveryInstructions && (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <button
              onClick={() => setDeliveryInstructionsOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-gray-500" />
                <span className="font-semibold text-gray-700 text-sm">Delivery Instructions</span>
              </div>
              {deliveryInstructionsOpen
                ? <ChevronUp className="w-4 h-4 text-gray-400" />
                : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {deliveryInstructionsOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-200">
                {customer.delivery_instructions && (
                  <p className="text-sm text-gray-800 whitespace-pre-wrap pt-3">{customer.delivery_instructions}</p>
                )}
                {customer.map_image_url && (
                  <img
                    src={customer.map_image_url}
                    alt="Delivery map"
                    className="rounded-lg border border-gray-200 w-full object-contain max-h-64"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Dispatcher Notes — styled to match the yards / load configuration block */}
        {job.dispatcher_notes && (
          <div
            ref={dispatcherNotesRef}
            className={cn(
              "rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-3",
              pulseNotes && "animate-note-pulse"
            )}
          >
            <FileText className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-amber-900 text-base leading-tight">Dispatcher Notes</p>
              <p className="text-amber-800 font-medium text-sm mt-0.5 whitespace-pre-wrap">{job.dispatcher_notes}</p>
            </div>
          </div>
        )}

        {/* PICKUP JOB: Per-load yards tracking (all pickup drivers) */}
        {isPickupJob && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className={cn("w-4 h-4", deYellow ? "text-gray-500" : "text-amber-600")} />
                Loads — Enter Yards Per Load
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loads.map((load, i) => (
                  <PickupLoadRow
                    key={load.load_number}
                    load={load}
                    onChange={(updated) => handleUpdateLoad(i, updated)}
                    disabled={isCompleted}
                    yardPresets={yardPresets}
                    truckType={job.truck_type}
                  />
                ))}
              </div>
              {!allLoadsCompleted && isPending && (
                <p className="text-xs text-gray-500 mt-3 text-center">
                  {completedLoadsCount} of {loads.length} loads completed
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* JOSH DELIVERY: Per-load pickup location + yards tracking */}
        {isJoshDelivery && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className={cn("w-4 h-4", deYellow ? "text-gray-500" : "text-amber-600")} />
                Loads — Pickup Info Per Load
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loads.map((load, i) => (
                  <JoshLoadRow
                    key={load.load_number}
                    deYellow={deYellow}
                    yardOptions={yardOptionsFor(load)}
                    load={load}
                    initialLoad={initialLoads[i]}
                    onChange={(updated) => handleUpdateLoad(i, updated)}
                    disabled={isCompleted}
                    joshPickupLocations={joshPickupLocations}
                  />
                ))}
              </div>
              {!allLoadsCompleted && isPending && (
                <p className="text-xs text-gray-500 mt-3 text-center">
                  {completedLoadsCount} of {loads.length} loads completed
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* NON-SPREADER DELIVERY: Read-only per-load info from dispatcher */}
        {!isLoadBased && !isPickupJob && Array.isArray(job.loads) && job.loads.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-500" />
                Load Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {job.loads.map((load) => (
                  <div key={load.load_number} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-sm font-semibold text-gray-700 mb-1">Load {load.load_number}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                      {load.pickup_location_name && (
                        <span>Pickup: <span className="font-medium text-gray-800">{load.pickup_location_name}</span></span>
                      )}
                      {load.yards_collected && (
                        <span>Yards: <span className="font-medium text-gray-800">{load.yards_collected} yds</span></span>
                      )}
                      {load.load_configuration && (
                        <span>Config: <span className="font-medium text-gray-800">{load.load_configuration}</span></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* REGULAR DRIVER (not Jon pickup or Josh delivery): Simple load completion */}
        {!isLoadBased && isPending && job.quantity > 1 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Load Completion</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Array.from({ length: parseInt(job.quantity) || 1 }, (_, i) => i + 1).map(loadNum => (
                  <div
                    key={loadNum}
                    onClick={() => toggleSimpleLoad(loadNum)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all",
                      simpleCompletedLoads.includes(loadNum)
                        ? "bg-green-50 border-green-500"
                        : "bg-white border-gray-200 hover:border-gray-300"
                    )}
                  >
                    <span className={cn(
                      "font-medium text-base",
                      simpleCompletedLoads.includes(loadNum) ? "text-green-700" : "text-gray-700"
                    )}>
                      Load {loadNum}
                    </span>
                    <div className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center transition-all",
                      simpleCompletedLoads.includes(loadNum) ? "bg-green-500" : "bg-gray-200"
                    )}>
                      {simpleCompletedLoads.includes(loadNum) && <Check className="w-4 h-4 text-white" />}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Invoice status info (delivery jobs) */}
        {isDelivery && (
          <Card className={cn(
            invoiceSet ? (job.invoice_sent === 'yes' ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200") : (deYellow ? "bg-gray-50 border-gray-300" : "bg-amber-50 border-amber-300")
          )}>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <FileText className={cn("w-5 h-5", invoiceSet ? (job.invoice_sent === 'yes' ? "text-green-600" : "text-gray-500") : (deYellow ? "text-gray-500" : "text-amber-600"))} />
                <div>
                  <p className="text-sm font-medium">Invoice Status</p>
                  {invoiceSet
                    ? <p className="text-xs text-gray-500">{job.invoice_sent === 'yes' ? 'Invoice sent to customer' : 'No invoice — not billed'}</p>
                    : <p className={cn("text-xs font-medium", deYellow ? "text-gray-500" : "text-amber-700")}>Invoice status must be set by dispatcher before completing</p>
                  }
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payment Toggle — only for delivery jobs where invoice was sent */}
        {isDelivery && job.invoice_sent === 'yes' && (
          <Card className={cn(paymentCollected && "bg-green-50 border-green-200")}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <DollarSign className={cn("w-6 h-6", paymentCollected ? "text-green-600" : "text-gray-400")} />
                  <Label htmlFor="payment" className="text-base font-medium">Payment Collected</Label>
                </div>
                <Switch
                  id="payment"
                  checked={paymentCollected}
                  onCheckedChange={setPaymentCollected}
                  disabled={isUpdating}
                  className={cn(paymentCollected && "data-[state=checked]:bg-green-500")}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Driver Notes */}
        <div ref={driverNotesRef} className={cn(pulseNotes && !hasDispatcherNotes && "animate-note-pulse")}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Your Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Add notes about this job..."
                value={driverNotes}
                onChange={(e) => setDriverNotes(e.target.value)}
                rows={3}
                disabled={isUpdating}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg">
        {isPending ? (
          <div className="space-y-2">
            {isLoadBased && !allLoadsCompleted && (
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={handleSaveProgress}
                disabled={isUpdating}
              >
                {isUpdating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save Progress ({completedLoadsCount}/{loads.length} loads done)
              </Button>
            )}
            <Button
              className="w-full h-14 text-lg font-semibold bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              onClick={handleMarkCompleted}
              disabled={isUpdating || !canCompleteJob}
            >
              {isUpdating ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-5 h-5 mr-2" />
              )}
              {!loadsReady
                ? `Complete All ${loads.length} Loads First`
                : isDelivery && !invoiceSet
                  ? 'Invoice Status Required'
                  : 'Mark Job Completed'
              }
            </Button>
          </div>
        ) : (
          <Button
            className="w-full h-14 text-lg font-semibold"
            onClick={() => onUpdate({driver_notes: driverNotes, payment_collected: paymentCollected, ...paymentAuditDelta()}).then(() => onBack())}
            disabled={isUpdating}
          >
            {isUpdating ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
            Save and Close
          </Button>
        )}
      </div>
    </div>
  );
}