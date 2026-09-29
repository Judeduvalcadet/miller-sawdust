import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2, History, X, Search, CalendarDays } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useQueryClient } from "@tanstack/react-query";
import JobActivityTimeline from "@/components/admin/JobActivityTimeline";
import { addDays, getDay, format, lastDayOfMonth } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/entities";
import { JobMapPanel, NewCustomerForm, saveCustomerMapImage } from "@/components/admin/CustomerMapSection";

// V2 job form — QuickBooks-first. The V1 JobForm is untouched; this fork
// drives each load from the QB item catalog: pick the item and the truck,
// yardage and job-card label fill themselves. Layout:
//   Job type        | Scheduled date (one-time / recurring)
//   Customer        | Assign driver
//   Number of loads |
//   Load 1..N: pickup location | item, then truck / yards / config label.
// No "Invoice required" field: V2 invoicing works from linked invoices, so
// new jobs are simply saved as not-yet-invoiced for the V1 screens.

const TRUCK_TYPES = [
  { value: 'straight_truck', label: 'Straight Truck' },
  { value: 'semi', label: 'Semi Truck' },
  { value: 'spreader', label: 'Spreader' },
];
const truckLabel = (v) => TRUCK_TYPES.find((t) => t.value === v)?.label || 'Any';
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The same calendar styling the invoice pages use.
const CALENDAR_CLASSES = {
  caption_label: 'text-sm font-semibold text-gray-900',
  head_cell: 'w-10 pb-1 font-medium text-[10px] uppercase tracking-wide text-gray-400',
  cell: 'p-0.5 text-center',
  day: 'inline-flex items-center justify-center h-9 w-9 rounded-lg text-sm font-normal text-gray-700 transition-colors hover:bg-gray-100 aria-selected:opacity-100',
  day_selected: 'bg-gray-950 text-white font-semibold hover:bg-gray-950 hover:text-white focus:bg-gray-950 focus:text-white',
  day_today: 'font-bold text-gray-950 underline underline-offset-4 decoration-2',
  day_outside: 'text-gray-300',
};

/* Inline QuickBooks item picker: closed it shows the pick; clicked it opens
   a search box listing every active load item, filtering as you type. */
function ItemSearch({ items, value, onPick, error }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const sel = items.find((i) => i.id === value);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setQ(''); setOpen(true); }}
        className={cn(
          'w-full h-8 px-2.5 text-xs text-left rounded-md border bg-white flex items-center justify-between gap-2',
          error ? 'border-red-500' : 'border-input',
          sel ? 'text-gray-900' : 'text-gray-400'
        )}
      >
        <span className="truncate">{sel ? sel.name : 'Search QuickBooks items…'}</span>
        <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>
    );
  }

  const list = items.filter((it) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${it.name} ${it.display_label || ''} ${it.yards ?? ''}`.toLowerCase().includes(needle);
  });

  return (
    <div className="relative">
      <Input
        autoFocus
        value={q}
        placeholder="Type to search items…"
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        className="h-8 text-xs bg-white"
      />
      <div className="absolute z-40 mt-1 w-[380px] max-w-[80vw] max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
        {list.map((it) => (
          <button
            key={it.id}
            type="button"
            onMouseDown={() => { onPick(it); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-baseline gap-2"
          >
            <span className="text-xs text-gray-900 flex-1 min-w-0 truncate">{it.name}</span>
            <span className="text-[10px] text-gray-400 shrink-0">{truckLabel(it.truck_type)}{it.yards != null ? ` · ${it.yards} yds` : ''}</span>
          </button>
        ))}
        {list.length === 0 && <p className="px-3 py-2 text-xs text-gray-400 italic">No items match.</p>}
      </div>
    </div>
  );
}

export default function V2JobForm({ job, drivers, customers, pickupLocations, dropOffLocations = [], onSubmit, onCancel, onDelete, isLoading, userRole = 'admin' }) {
  const [formData, setFormData] = useState({
    job_type: job?.job_type || 'delivery',
    truck_type: job?.truck_type || 'straight_truck',
    scheduled_date: job?.scheduled_date || new Date().toISOString().split('T')[0],
    assigned_driver_id: job?.assigned_driver_id || '',
    customer_id: job?.customer_id || '',
    pickup_location_id: job?.job_type === 'pickup' ? (job?.pickup_location_id || '') : '',
    dropoff_location_id: job?.dropoff_location_id || '',
    quantity: job?.quantity || 1,
    pickup_yards: job?.pickup_yards || '',
    dispatcher_notes: job?.dispatcher_notes || '',
    status: job?.status || 'pending',
  });
  const [errors, setErrors] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [extraCustomers, setExtraCustomers] = useState([]);
  const [newCustomerPin, setNewCustomerPin] = useState(null);
  const [newCustomerBlob, setNewCustomerBlob] = useState(null);
  const [newCustomerInstructions, setNewCustomerInstructions] = useState('');
  const [newCustomerDirty, setNewCustomerDirty] = useState(false);
  const [customerMapNote, setCustomerMapNote] = useState('');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const queryClient = useQueryClient();
  const [showActivity, setShowActivity] = useState(false);
  const [scheduleType, setScheduleType] = useState('one_time');
  const [recurringInterval, setRecurringInterval] = useState('');
  const [customInterval, setCustomInterval] = useState('');
  const [repeatUntilMonth, setRepeatUntilMonth] = useState('');
  const [intervalPresets, setIntervalPresets] = useState([7, 10, 14]);
  const [isCreatingRecurring, setIsCreatingRecurring] = useState(false);
  const [recurringProgress, setRecurringProgress] = useState('');
  const [yardPresets, setYardPresets] = useState({ straight_truck: [25, 30, 40], semi: [75, 90, 120], spreader: [50, 60, 80] });
  const [loadItems, setLoadItems] = useState([]); // QuickBooks load catalog
  const [pickupYardsMode, setPickupYardsMode] = useState(() => (job?.pickup_yards ? 'custom' : 'preset'));

  const initLoads = (qty) =>
    Array.from({ length: parseInt(qty) || 1 }, (_, i) => {
      const loadNum = i + 1;
      const found = (job?.loads || []).find((l) => l.load_number === loadNum);
      return {
        load_number: loadNum,
        pickup_location_name: found?.pickup_location_name || '',
        item_id: found?.item_id || '',
        truck_type: found?.truck_type || (found ? (job?.truck_type || '') : ''),
        yards_collected: found?.yards_collected != null && found?.yards_collected !== '' ? String(found.yards_collected) : '',
        load_configuration: found?.load_configuration || '',
      };
    });
  const [loads, setLoads] = useState(() => initLoads(job?.quantity));

  // Keep the load sections in step with the Number of Loads field.
  useEffect(() => {
    if (formData.job_type === 'pickup') return;
    setLoads((prev) => {
      const qty = parseInt(formData.quantity) || 1;
      return Array.from({ length: qty }, (_, i) =>
        prev.find((l) => l.load_number === i + 1) ||
        { load_number: i + 1, pickup_location_name: '', item_id: '', truck_type: '', yards_collected: '', load_configuration: '' });
    });
  }, [formData.quantity]);

  useEffect(() => {
    base44.entities.Settings.list().then((results) => {
      if (results.length > 0) {
        if (results[0].truck_yard_presets) setYardPresets(results[0].truck_yard_presets);
        if (results[0].recurring_interval_presets) setIntervalPresets(results[0].recurring_interval_presets);
      }
    });
    base44.entities.Item.filter({ is_load_item: true, active: true }, 'sort_order')
      .then((list) => setLoadItems(list || []))
      .catch(() => {});
  }, []);

  const calculateRecurringDates = (startDate, intervalDays, endMonth) => {
    const dates = [];
    const endDate = lastDayOfMonth(new Date(endMonth + '-01T00:00:00'));
    let current = new Date(startDate + 'T00:00:00');
    while (current <= endDate) {
      const day = getDay(current);
      if (day === 0) current = addDays(current, 1);
      if (day === 6) current = addDays(current, 2);
      if (current <= endDate) dates.push(format(current, 'yyyy-MM-dd'));
      current = addDays(current, intervalDays);
    }
    return dates;
  };

  const canAssign = userRole === 'dispatcher' || userRole === 'admin' || userRole === 'scheduler';
  const set = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));
  const isPickup = formData.job_type === 'pickup';
  const setLoad = (i, patch) => setLoads((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  useEffect(() => {
    if (isPickup && !job) {
      set('truck_type', 'semi');
      set('pickup_location_id', '');
      set('dropoff_location_id', '');
    }
  }, [formData.job_type]);

  const deliveryDrivers = drivers.filter((d) => d.active && d.role === 'driver');
  const assignedDriver = drivers.find((d) => d.id === formData.assigned_driver_id);

  const pickItem = (i, it) => {
    setLoad(i, {
      item_id: it.id,
      // Item truck wins; 'any' items leave the choice open.
      truck_type: it.truck_type || loads[i].truck_type || '',
      // Spreader loads: the driver logs the yards actually collected at their
      // own pickup, so leave the field for them — prefilled yards plus a
      // prefilled pickup would make the driver app treat the load as done.
      yards_collected: it.truck_type === 'spreader'
        ? loads[i].yards_collected
        : (it.yards != null ? String(it.yards) : loads[i].yards_collected),
      // The job card shows this label; the item link is what prices the invoice.
      load_configuration: it.display_label || it.name || '',
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    if (isPickup && !formData.pickup_location_id) newErrors.pickup_location_id = 'Required field';
    if (!isPickup && !formData.customer_id) newErrors.customer_id = 'Required field';
    if (!formData.scheduled_date) newErrors.scheduled_date = 'Required field';
    if (!formData.quantity || formData.quantity < 1) newErrors.quantity = 'Required field';
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    setErrors({});

    let locationData = {};
    if (isPickup) {
      const location = pickupLocations.find((l) => l.id === formData.pickup_location_id);
      const dropoff = dropOffLocations.find((l) => l.id === formData.dropoff_location_id);
      if (location) {
        locationData = {
          pickup_location_id: location.id,
          customer_id: null,
          location_name: location.name,
          address: location.address,
          phone: location.phone || '',
          dropoff_location_id: dropoff?.id || null,
          dropoff_location_name: dropoff?.name || null,
        };
      }
    } else {
      const customer = allCustomers.find((c) => c.id === formData.customer_id);
      if (customer) {
        const stateZip = [customer.state, customer.zip_code].filter(Boolean).join(' ');
        const combinedAddress = [customer.street_address, customer.city, stateZip, customer.country]
          .filter(Boolean).join(', ') || customer.address || '';
        locationData = {
          customer_id: customer.id,
          pickup_location_id: null,
          location_name: customer.name || customer.company_name || customer.business_name || '',
          customer_company_name: customer.company_name || '',
          address: combinedAddress,
          phone: customer.phone || '',
        };
      }
    }

    const loadsData = !isPickup ? loads.map((l) => ({
      load_number: l.load_number,
      pickup_location_name: l.pickup_location_name || null,
      yards_collected: l.yards_collected ? parseFloat(l.yards_collected) : null,
      load_configuration: l.load_configuration || null,
      item_id: l.item_id || null,
      truck_type: l.truck_type || null,
      completed: !!(l.pickup_location_name && l.yards_collected),
    })) : undefined;

    const totalYards = loadsData ? loadsData.reduce((s, l) => s + (l.yards_collected || 0), 0) : null;
    const joinedConfig = loadsData ? loadsData.map((l) => l.load_configuration).filter(Boolean).join(', ') : null;

    let jobPickupLocationId = locationData.pickup_location_id || null;
    if (!isPickup && loadsData?.[0]?.pickup_location_name) {
      const firstPickup = pickupLocations.find((l) => l.name === loadsData[0].pickup_location_name);
      if (firstPickup) jobPickupLocationId = firstPickup.id;
    }

    const jobData = {
      ...formData,
      ...locationData,
      truck_type: isPickup
        ? formData.truck_type
        : (loadsData?.find((l) => l.truck_type)?.truck_type || formData.truck_type || 'straight_truck'),
      pickup_location_id: isPickup ? locationData.pickup_location_id : jobPickupLocationId,
      assigned_driver_id: assignedDriver?.id || formData.assigned_driver_id || null,
      assigned_driver_name: assignedDriver?.name || null,
      assigned_driver_pickup_role: assignedDriver?.pickup_role || 'none',
      quantity: parseInt(formData.quantity) || 1,
      pickup_yards: isPickup ? (parseFloat(formData.pickup_yards) || null) : undefined,
      delivery_yards: !isPickup ? (totalYards || null) : undefined,
      load_configuration: !isPickup ? (joinedConfig || null) : undefined,
      item_id: !isPickup ? (loadsData?.find((l) => l.item_id)?.item_id || null) : undefined,
      loads: loadsData,
      // V2 has no "Invoice required" question. Keep whatever an existing job
      // already had; new delivery jobs start as not-yet-invoiced so the V1
      // screens and driver app show a normal state.
      invoice_sent: isPickup ? undefined : (job?.invoice_sent || 'no'),
    };

    if (scheduleType === 'recurring' && !job?.id) {
      const interval = recurringInterval === 'custom' ? parseInt(customInterval) : parseInt(recurringInterval);
      if (!interval || interval <= 0 || !repeatUntilMonth) {
        setErrors((prev) => ({ ...prev, recurring: 'Please set interval and end month' }));
        return;
      }
      const dates = calculateRecurringDates(formData.scheduled_date, interval, repeatUntilMonth);
      if (dates.length === 0) {
        setErrors((prev) => ({ ...prev, recurring: 'No valid dates in the selected range' }));
        return;
      }
      setIsCreatingRecurring(true);
      setRecurringProgress(`Creating ${dates.length} jobs...`);
      try {
        const { scheduled_date, ...templateData } = jobData;
        for (let i = 0; i < dates.length; i++) {
          setRecurringProgress(`Creating job ${i + 1} of ${dates.length}...`);
          await base44.entities.Job.create({ ...templateData, scheduled_date: dates[i] });
        }
        setRecurringProgress(`Created ${dates.length} jobs!`);
        setTimeout(() => onCancel(), 1000);
      } catch (err) {
        setRecurringProgress(`Error: ${err.message}`);
      }
      setIsCreatingRecurring(false);
      return;
    }

    onSubmit(jobData);
  };

  const allCustomers = [
    ...customers,
    ...extraCustomers.filter((x) => !customers.some((c) => c.id === x.id)),
  ];
  const selectedCustomer = allCustomers.find((c) => c.id === formData.customer_id) || null;

  const initialSnapRef = useRef();
  if (initialSnapRef.current === undefined) {
    initialSnapRef.current = JSON.stringify({ f: formData, l: loads });
  }
  const isDirty = () =>
    JSON.stringify({ f: formData, l: loads }) !== initialSnapRef.current ||
    newCustomerDirty || !!newCustomerBlob;
  const requestClose = () => { isDirty() ? setShowExitConfirm(true) : onCancel(); };

  const selectedPickupLoc = pickupLocations.find((l) => l.id === formData.pickup_location_id) || null;
  let mapPin = null, mapTitle = '', mapWaiting = '', mapMode = 'none';
  if (!isPickup && showNewCustomer) {
    mapMode = 'new';
    mapPin = newCustomerPin;
    mapTitle = 'New customer';
    mapWaiting = 'Pick an address suggestion on the left and the pin drops here.';
  } else if (!isPickup && selectedCustomer) {
    mapTitle = `${(selectedCustomer.company_name || selectedCustomer.name || '').trim()}, ${[selectedCustomer.street_address, selectedCustomer.city].filter(Boolean).join(', ')}`;
    if (selectedCustomer.latitude != null) {
      mapMode = 'customer';
      mapPin = { lat: selectedCustomer.latitude, lng: selectedCustomer.longitude };
    } else {
      mapWaiting = "This customer's address isn't map-verified yet. Fix it on the Customers page and the pin appears automatically.";
    }
  } else if (isPickup && selectedPickupLoc) {
    mapTitle = selectedPickupLoc.name;
    if (selectedPickupLoc.latitude != null) mapPin = { lat: selectedPickupLoc.latitude, lng: selectedPickupLoc.longitude };
    else mapWaiting = "This location's address isn't map-verified yet.";
  } else {
    mapWaiting = isPickup
      ? 'Choose a pickup location and the map flies to it.'
      : 'Choose a customer and the map flies to their pin.';
  }

  const customerOptions = allCustomers.map((c) => ({
    value: c.id,
    label: c.name
      ? (c.company_name ? `${c.name} — ${c.company_name}` : c.name)
      : (c.company_name || c.business_name || ''),
  }));
  const byLabel = (a, b) => (a.label || '').localeCompare(b.label || '');
  const pickupLocationOptions = pickupLocations.map((l) => ({ value: l.id, label: l.name })).sort(byLabel);
  const dropOffLocationOptions = dropOffLocations.map((l) => ({ value: l.id, label: l.name })).sort(byLabel);
  const pickupNameOptions = pickupLocations.map((l) => ({ value: l.name, label: l.name })).sort(byLabel);

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-2 pt-1 pb-3">
        <CardTitle>{job?.id ? 'Edit Job' : 'Create New Job'}</CardTitle>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          className="w-11 h-11 flex items-center justify-center rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors shrink-0"
        >
          <X className="w-6 h-6" />
        </button>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <div className="flex flex-col lg:flex-row gap-6 items-stretch">
        <form onSubmit={handleSubmit} className="space-y-4 flex-1 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Job Type */}
            <div className="space-y-2">
              <Label>Job Type</Label>
              <Select value={formData.job_type} onValueChange={(v) => {
                set('job_type', v);
                set('assigned_driver_id', '');
                set('pickup_location_id', '');
                set('customer_id', '');
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Scheduled Date + one-time / recurring */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{scheduleType === 'recurring' ? 'Start Date' : 'Scheduled Date'}</Label>
                {!job?.id && (
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => { setScheduleType('one_time'); setErrors((p) => ({ ...p, recurring: '' })); }}
                      className={cn(
                        "py-0.5 px-2.5 text-[10px] font-medium rounded-l border transition-colors",
                        scheduleType === 'one_time'
                          ? "bg-gray-950 text-white border-gray-950"
                          : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      One-time
                    </button>
                    <button
                      type="button"
                      onClick={() => { setScheduleType('recurring'); setErrors((p) => ({ ...p, recurring: '' })); }}
                      className={cn(
                        "py-0.5 px-2.5 text-[10px] font-medium rounded-r border-t border-r border-b transition-colors",
                        scheduleType === 'recurring'
                          ? "bg-gray-950 text-white border-gray-950"
                          : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      Recurring
                    </button>
                  </div>
                )}
              </div>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex h-10 w-full items-center justify-between rounded-md border bg-white px-3 py-2 text-sm',
                      errors.scheduled_date ? 'border-red-500' : 'border-input',
                      formData.scheduled_date ? 'text-gray-900' : 'text-gray-400'
                    )}
                  >
                    {formData.scheduled_date
                      ? new Date(formData.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                      : 'Pick a date…'}
                    <CalendarDays className="w-4 h-4 text-gray-400" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-3 rounded-2xl border-gray-200 shadow-lg">
                  <Calendar
                    mode="single"
                    selected={formData.scheduled_date ? new Date(formData.scheduled_date + 'T00:00:00') : undefined}
                    defaultMonth={formData.scheduled_date ? new Date(formData.scheduled_date + 'T00:00:00') : new Date()}
                    onSelect={(d) => {
                      if (!d) return;
                      set('scheduled_date', isoDate(d));
                      setErrors((p) => ({ ...p, scheduled_date: '' }));
                      setDateOpen(false);
                    }}
                    classNames={CALENDAR_CLASSES}
                  />
                </PopoverContent>
              </Popover>
              {errors.scheduled_date && <p className="text-xs text-red-500">{errors.scheduled_date}</p>}
            </div>

            {/* Recurring options */}
            {!job?.id && scheduleType === 'recurring' && (
              <div className="col-span-1 md:col-span-2 bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">Repeat Every</Label>
                    <Select value={recurringInterval} onValueChange={(v) => { setRecurringInterval(v); if (v !== 'custom') setCustomInterval(''); }}>
                      <SelectTrigger><SelectValue placeholder="Select interval..." /></SelectTrigger>
                      <SelectContent>
                        {intervalPresets.map((d) => (
                          <SelectItem key={d} value={String(d)}>Every {d} days</SelectItem>
                        ))}
                        <SelectItem value="custom">Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                    {recurringInterval === 'custom' && (
                      <Input
                        type="number" min="1" placeholder="Enter days (e.g. 12)"
                        value={customInterval}
                        onChange={(e) => setCustomInterval(e.target.value)}
                        autoFocus
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">Through End Of</Label>
                    <Select value={repeatUntilMonth} onValueChange={setRepeatUntilMonth}>
                      <SelectTrigger><SelectValue placeholder="Select month..." /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => {
                          const d = new Date();
                          d.setDate(1);
                          d.setMonth(d.getMonth() + i);
                          const val = format(d, 'yyyy-MM');
                          return <SelectItem key={val} value={val}>{format(d, 'MMMM yyyy')}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {(() => {
                  const interval = recurringInterval === 'custom' ? parseInt(customInterval) : parseInt(recurringInterval);
                  if (interval > 0 && repeatUntilMonth && formData.scheduled_date) {
                    const dates = calculateRecurringDates(formData.scheduled_date, interval, repeatUntilMonth);
                    return (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-blue-700 font-medium">
                          {dates.length} job{dates.length !== 1 ? 's' : ''} will be created
                          {dates.length > 0 && ` · First: ${format(new Date(dates[0] + 'T00:00:00'), 'MMM d')} · Last: ${format(new Date(dates[dates.length - 1] + 'T00:00:00'), 'MMM d, yyyy')}`}
                        </p>
                      </div>
                    );
                  }
                  return null;
                })()}
                {errors.recurring && <p className="text-xs text-red-500">{errors.recurring}</p>}
              </div>
            )}

            {/* Customer (delivery) or Pickup Location (pickup) */}
            {isPickup ? (
              <div className="space-y-2">
                <Label>Pickup Location</Label>
                <SearchableSelect
                  value={formData.pickup_location_id}
                  onValueChange={(v) => { set('pickup_location_id', v); setErrors((p) => ({ ...p, pickup_location_id: '' })); }}
                  options={pickupLocationOptions}
                  placeholder="Search pickup locations..."
                  error={errors.pickup_location_id}
                />
                {errors.pickup_location_id && <p className="text-xs text-red-500">{errors.pickup_location_id}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Customer</Label>
                  <button
                    type="button"
                    onClick={() => setShowNewCustomer((v) => {
                      if (!v) { set('customer_id', ''); setCustomerMapNote(''); }
                      return !v;
                    })}
                    className="text-xs font-medium text-gray-700 hover:text-gray-950 underline underline-offset-2"
                  >
                    {showNewCustomer ? 'Cancel new customer' : '+ New customer'}
                  </button>
                </div>
                <SearchableSelect
                  value={formData.customer_id}
                  onValueChange={(v) => { set('customer_id', v); setErrors((p) => ({ ...p, customer_id: '' })); setCustomerMapNote(''); }}
                  options={customerOptions}
                  placeholder="Search customer..."
                  error={errors.customer_id}
                />
                {errors.customer_id && <p className="text-xs text-red-500">{errors.customer_id}</p>}
              </div>
            )}

            {/* Inline new customer */}
            {!isPickup && showNewCustomer && (
              <NewCustomerForm
                mapBlob={newCustomerBlob}
                mapInstructions={newCustomerInstructions}
                onPinChange={setNewCustomerPin}
                onDirty={() => setNewCustomerDirty(true)}
                onCancel={() => {
                  setShowNewCustomer(false);
                  setNewCustomerPin(null);
                  setNewCustomerBlob(null);
                  setNewCustomerInstructions('');
                  setNewCustomerDirty(false);
                }}
                onCreated={(created) => {
                  setExtraCustomers((prev) => [...prev, created]);
                  set('customer_id', created.id);
                  setErrors((p) => ({ ...p, customer_id: '' }));
                  setShowNewCustomer(false);
                  setNewCustomerPin(null);
                  setNewCustomerBlob(null);
                  setNewCustomerInstructions('');
                  setNewCustomerDirty(false);
                }}
              />
            )}

            {/* Assign Driver */}
            {canAssign && (
              <div className="space-y-2">
                <Label>Assign Driver</Label>
                <Select
                  value={formData.assigned_driver_id}
                  onValueChange={(v) => set('assigned_driver_id', v)}
                >
                  <SelectTrigger><SelectValue placeholder="Select driver..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>Unassigned</SelectItem>
                    {deliveryDrivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Drop-Off Location (pickup jobs) */}
            {isPickup && (
              <div className="space-y-2">
                <Label>Drop-Off Location <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
                <SearchableSelect
                  value={formData.dropoff_location_id}
                  onValueChange={(v) => set('dropoff_location_id', v)}
                  options={dropOffLocationOptions}
                  placeholder="Search drop-off location..."
                />
              </div>
            )}

            {/* Yards to collect (pickup jobs) */}
            {isPickup && (
              <div className="space-y-2">
                <Label>Yards to Collect</Label>
                {pickupYardsMode === 'preset' ? (
                  <Select
                    value={formData.pickup_yards !== '' ? String(formData.pickup_yards) : ''}
                    onValueChange={(v) => {
                      if (v === 'custom') { setPickupYardsMode('custom'); set('pickup_yards', ''); }
                      else set('pickup_yards', parseFloat(v));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select yards..." /></SelectTrigger>
                    <SelectContent>
                      {(yardPresets[formData.truck_type] || []).map((y) => (
                        <SelectItem key={y} value={String(y)}>{y} yds</SelectItem>
                      ))}
                      <SelectItem value="custom">Custom...</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      type="number" min="0" step="0.5" placeholder="Enter yards..."
                      value={formData.pickup_yards}
                      onChange={(e) => set('pickup_yards', e.target.value)}
                      autoFocus
                    />
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setPickupYardsMode('preset'); set('pickup_yards', ''); }}
                      className="shrink-0 text-xs"
                    >
                      Presets
                    </Button>
                  </div>
                )}
                <p className="text-xs text-gray-500">Yards collected at this pickup location</p>
              </div>
            )}

            {/* Number of loads */}
            <div className="space-y-2">
              <Label>Number of Loads</Label>
              <Input
                type="number" min="1"
                value={formData.quantity}
                onChange={(e) => { set('quantity', e.target.value); setErrors((p) => ({ ...p, quantity: '' })); }}
                className={errors.quantity ? 'border-red-500' : ''}
                required
              />
              {errors.quantity && <p className="text-xs text-red-500">{errors.quantity}</p>}
              {isPickup && <p className="text-xs text-gray-500">Each load will require yards entry on the job detail page</p>}
            </div>

            {/* Per-load sections — delivery jobs */}
            {!isPickup && (
              <div className="col-span-1 md:col-span-2 space-y-3">
                {loads.map((load, i) => {
                  return (
                    <div key={load.load_number} className="border rounded-lg p-3 space-y-3 bg-gray-50 border-gray-200">
                      <p className="text-sm font-semibold text-blue-900">Load {load.load_number}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-gray-500">Pickup Location <span className="text-gray-400">(optional)</span></Label>
                          <SearchableSelect
                            value={load.pickup_location_name}
                            onValueChange={(v) => setLoad(i, { pickup_location_name: v })}
                            options={pickupNameOptions}
                            placeholder="Search location..."
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-gray-500">Item <span className="text-gray-400">(QuickBooks)</span></Label>
                          <ItemSearch items={loadItems} value={load.item_id} onPick={(it) => pickItem(i, it)} />
                        </div>
                      </div>
                      {/* Truck / yards / config — filled by the item; truck stays
                          open when the item says Any. */}
                      <div className="flex gap-3">
                        <div className="space-y-1 w-44 shrink-0">
                          <Label className="text-xs text-gray-500">Truck Type</Label>
                          <Select
                            value={load.truck_type || ''}
                            onValueChange={(v) => setLoad(i, { truck_type: v })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder={load.item_id ? 'Choose truck…' : '—'} />
                            </SelectTrigger>
                            <SelectContent>
                              {TRUCK_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1 w-24 shrink-0">
                          <Label className="text-xs text-gray-500">Yards</Label>
                          <Input
                            type="number" min="0" max="999" step="0.5"
                            value={load.yards_collected}
                            onChange={(e) => setLoad(i, { yards_collected: e.target.value })}
                            className="no-spin h-8 text-xs text-right"
                          />
                        </div>
                        <div className="space-y-1 flex-1 min-w-0">
                          <Label className="text-xs text-gray-500">Config <span className="text-gray-400">(job-card label)</span></Label>
                          <Input
                            value={load.load_configuration}
                            onChange={(e) => setLoad(i, { load_configuration: e.target.value })}
                            placeholder="Filled by the item…"
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Status (edit only) */}
            {job?.id && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={formData.dispatcher_notes}
              onChange={(e) => set('dispatcher_notes', e.target.value)}
              placeholder="Add notes for the driver..."
              rows={3}
            />
          </div>

          <div className="flex justify-between items-center pt-4">
            <div className="flex items-center gap-2">
              {job?.id && onDelete && (
                <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(true)} className="text-red-600 border-red-300 hover:bg-red-50">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              )}
              {job?.id && (
                <Button type="button" variant="outline" onClick={() => setShowActivity((v) => !v)}>
                  <History className="w-4 h-4 mr-2" />
                  {showActivity ? 'Hide Detail' : 'More Detail'}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {recurringProgress && (
                <span className="text-xs text-blue-600 font-medium">{recurringProgress}</span>
              )}
              <Button type="button" variant="outline" onClick={requestClose} disabled={isCreatingRecurring}>Cancel</Button>
              <Button type="submit" disabled={isLoading || isCreatingRecurring} className="bg-gray-950 hover:bg-gray-800">
                {(isLoading || isCreatingRecurring) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {job?.id ? 'Update Job' : (scheduleType === 'recurring' ? 'Create Recurring Jobs' : 'Create Job')}
              </Button>
            </div>
          </div>

          <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure you want to delete this job?</AlertDialogTitle>
                <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-red-600 hover:bg-red-700">Confirm Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {job?.id && showActivity && (
            <div className="border-t pt-4">
              <JobActivityTimeline job={job} />
            </div>
          )}
        </form>

        {/* Right column: the map */}
        <div className="w-full lg:w-[48%] shrink-0 lg:sticky lg:top-0 self-start">
          <div className="h-[340px] lg:h-[72vh] lg:min-h-[480px]">
            <JobMapPanel
              pin={mapPin}
              title={mapTitle}
              waitingText={mapWaiting}
              canCapture={mapMode === 'new' || mapMode === 'customer'}
              savedNote={mapMode === 'new'
                ? (newCustomerBlob ? 'Picture attached — saves with the customer' : '')
                : customerMapNote}
              initialInstructions={mapMode === 'new'
                ? newCustomerInstructions
                : (selectedCustomer?.delivery_instructions || '')}
              onSaveImage={async (blob, instructions) => {
                if (mapMode === 'new') {
                  setNewCustomerBlob(blob);
                  setNewCustomerInstructions(instructions || '');
                } else if (mapMode === 'customer' && selectedCustomer) {
                  await saveCustomerMapImage(queryClient, selectedCustomer.id, blob, instructions);
                  setCustomerMapNote("Saved as this customer's map picture");
                }
              }}
            />
          </div>
        </div>
        </div>

        {/* Exit guard */}
        <AlertDialog open={showExitConfirm} onOpenChange={setShowExitConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Exit without saving?</AlertDialogTitle>
              <AlertDialogDescription>Anything you entered here will be lost.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction onClick={onCancel} className="bg-gray-900 hover:bg-gray-700">Exit</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
