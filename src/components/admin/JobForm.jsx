import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertCircle, Trash2, CalendarDays } from "lucide-react";
import { addDays, getDay, format, lastDayOfMonth } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/entities";

const TRUCK_TYPES = [
  { value: 'straight_truck', label: 'Straight Truck' },
  { value: 'semi', label: 'Semi Truck' },
  { value: 'spreader', label: 'Spreader' },
];

const DEFAULT_PRESETS = {
  straight_truck: [25, 30, 40],
  semi: [75, 90, 120],
  spreader: [50, 60, 80],
};

export default function JobForm({ job, drivers, customers, pickupLocations, dropOffLocations = [], onSubmit, onCancel, onDelete, isLoading, userRole = 'admin' }) {
  const isDeliveryJob = job?.job_type === 'delivery';

  const [formData, setFormData] = useState({
    job_type: job?.job_type || 'delivery',
    truck_type: job?.truck_type || 'straight_truck',
    scheduled_date: job?.scheduled_date || new Date().toISOString().split('T')[0],
    assigned_driver_id: job?.assigned_driver_id || '',
    customer_id: job?.customer_id || '',
    pickup_location_id: isDeliveryJob ? '' : (job?.pickup_location_id || ''),
    regular_pickup_location_id: isDeliveryJob ? (job?.pickup_location_id || '') : '',
    dropoff_location_id: job?.dropoff_location_id || '',
    quantity: job?.quantity || 1,
    pickup_yards: job?.pickup_yards || '',
    delivery_yards: job?.delivery_yards || '',
    load_configuration: job?.load_configuration || '',
    dispatcher_notes: job?.dispatcher_notes || '',
    status: job?.status || 'pending',
    invoice_sent: job?.invoice_sent || ''
  });
  const [errors, setErrors] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [scheduleType, setScheduleType] = useState('one_time');
  const [recurringInterval, setRecurringInterval] = useState('');
  const [customInterval, setCustomInterval] = useState('');
  const [repeatUntilMonth, setRepeatUntilMonth] = useState('');
  const [intervalPresets, setIntervalPresets] = useState([7, 10, 14]);
  const [isCreatingRecurring, setIsCreatingRecurring] = useState(false);
  const [recurringProgress, setRecurringProgress] = useState('');
  const [yardPresets, setYardPresets] = useState(DEFAULT_PRESETS);
  const [yardsMode, setYardsMode] = useState(() => {
    if (job?.delivery_yards) return 'custom';
    return 'preset';
  });
  const [pickupYardsMode, setPickupYardsMode] = useState(() => {
    if (job?.pickup_yards) return 'custom';
    return 'preset';
  });

  const initDeliveryLoads = (qty, existingLoads = [], existingJob = null) => {
    const hasLoads = Array.isArray(existingLoads) && existingLoads.length > 0;
    // Old job without loads array — pre-populate load 1 from single fields
    if (!hasLoads && existingJob && (existingJob.delivery_yards || existingJob.load_configuration)) {
      const q = parseInt(qty) || 1;
      return Array.from({ length: q }, (_, i) => ({
        load_number: i + 1,
        pickup_location_name: '',
        yards_collected: i === 0 && existingJob.delivery_yards ? String(existingJob.delivery_yards) : '',
        load_configuration: i === 0 && existingJob.load_configuration ? existingJob.load_configuration : '',
        yards_mode: i === 0 && existingJob.delivery_yards ? 'custom' : 'preset',
      }));
    }
    return Array.from({ length: parseInt(qty) || 1 }, (_, i) => {
      const loadNum = i + 1;
      const found = (existingLoads || []).find(l => l.load_number === loadNum);
      return {
        load_number: loadNum,
        pickup_location_name: found?.pickup_location_name || '',
        yards_collected: found?.yards_collected ? String(found.yards_collected) : '',
        load_configuration: found?.load_configuration || '',
        yards_mode: found?.yards_collected ? 'custom' : 'preset',
      };
    });
  };
  const [deliveryLoads, setDeliveryLoads] = useState(() => initDeliveryLoads(job?.quantity, job?.loads, job));

  useEffect(() => {
    if (formData.job_type !== 'pickup') {
      setDeliveryLoads(prev => {
        const qty = parseInt(formData.quantity) || 1;
        return Array.from({ length: qty }, (_, i) => {
          const loadNum = i + 1;
          return prev.find(l => l.load_number === loadNum) ||
            { load_number: loadNum, pickup_location_name: '', yards_collected: '', load_configuration: '', yards_mode: 'preset' };
        });
      });
    }
  }, [formData.quantity]);

  useEffect(() => {
    base44.entities.Settings.list().then(results => {
      if (results.length > 0) {
        if (results[0].truck_yard_presets) {
          const p = results[0].truck_yard_presets;
          setYardPresets(p);
          if (job?.delivery_yards) {
            const presetList = p[formData.truck_type] || [];
            setYardsMode(presetList.includes(job.delivery_yards) ? 'preset' : 'custom');
          }
        }
        if (results[0].recurring_interval_presets) {
          setIntervalPresets(results[0].recurring_interval_presets);
        }
      }
    });
  }, []);

  // Calculate recurring dates with weekend push-to-Monday
  const calculateRecurringDates = (startDate, intervalDays, endMonth) => {
    const dates = [];
    const endDate = lastDayOfMonth(new Date(endMonth + '-01T00:00:00'));
    let current = new Date(startDate + 'T00:00:00');

    while (current <= endDate) {
      // Push weekends to Monday
      const day = getDay(current);
      if (day === 0) current = addDays(current, 1); // Sunday → Monday
      if (day === 6) current = addDays(current, 2); // Saturday → Monday

      if (current <= endDate) {
        dates.push(format(current, 'yyyy-MM-dd'));
      }
      // Next occurrence starts from the (possibly adjusted) date
      current = addDays(current, intervalDays);
    }
    return dates;
  };

  const canAssign = userRole === 'dispatcher' || userRole === 'admin' || userRole === 'scheduler';
  const invoiceRequired = formData.job_type === 'delivery' && !formData.invoice_sent;
  const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));
  const isPickup = formData.job_type === 'pickup';

  useEffect(() => {
    if (isPickup && !job) {
      set('truck_type', 'semi');
      set('pickup_location_id', '');
      set('dropoff_location_id', '');
    }
  }, [formData.job_type]);

  const deliveryDrivers = drivers.filter(d => d.active && d.role === 'driver');
  const assignedDriver = drivers.find(d => d.id === formData.assigned_driver_id);
  const assignedDriverName = assignedDriver?.name || '';
  const assignedPickupRole = assignedDriver?.pickup_role || 'none';
  const isSpreader = formData.truck_type === 'spreader';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    if (isPickup && !formData.pickup_location_id) newErrors.pickup_location_id = 'Required field';
    if (!isPickup && !formData.customer_id) newErrors.customer_id = 'Required field';
    if (!formData.scheduled_date) newErrors.scheduled_date = 'Required field';
    if (!formData.quantity || formData.quantity < 1) newErrors.quantity = 'Required field';
    if (!isPickup && !formData.invoice_sent) newErrors.invoice_sent = 'Please select Yes or No';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    let driverToAssign = assignedDriver;
    let locationData = {};

    if (isPickup) {
      const location = pickupLocations.find(l => l.id === formData.pickup_location_id);
      const dropoff = dropOffLocations.find(l => l.id === formData.dropoff_location_id);
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
      const customer = customers.find(c => c.id === formData.customer_id);
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
          phone: customer.phone || ''
        };
      }
    }

    // Build loads array for all delivery jobs
    const loadsData = !isPickup ? deliveryLoads.map(l => ({
      load_number: l.load_number,
      pickup_location_name: l.pickup_location_name || null,
      yards_collected: l.yards_collected ? parseFloat(l.yards_collected) : null,
      load_configuration: l.load_configuration || null,
      completed: !!(l.pickup_location_name && l.yards_collected),
    })) : undefined;

    // Backwards-compat: compute totals for old display code
    const totalYards = loadsData ? loadsData.reduce((s, l) => s + (l.yards_collected || 0), 0) : null;
    const joinedConfig = loadsData ? loadsData.map(l => l.load_configuration).filter(Boolean).join(', ') : null;

    // Set job-level pickup_location_id from first load's pickup name
    let jobPickupLocationId = locationData.pickup_location_id || null;
    if (!isPickup && loadsData?.[0]?.pickup_location_name) {
      const firstPickup = pickupLocations.find(l => l.name === loadsData[0].pickup_location_name);
      if (firstPickup) jobPickupLocationId = firstPickup.id;
    }

    const jobData = {
      ...formData,
      ...locationData,
      pickup_location_id: isPickup ? locationData.pickup_location_id : jobPickupLocationId,
      assigned_driver_id: driverToAssign?.id || formData.assigned_driver_id || null,
      assigned_driver_name: driverToAssign?.name || assignedDriverName || null,
      assigned_driver_pickup_role: driverToAssign?.pickup_role || assignedPickupRole || 'none',
      quantity: parseInt(formData.quantity) || 1,
      pickup_yards: isPickup ? (parseFloat(formData.pickup_yards) || null) : undefined,
      delivery_yards: !isPickup ? (totalYards || null) : undefined,
      load_configuration: !isPickup ? (joinedConfig || null) : undefined,
      loads: loadsData,
      invoice_sent: isPickup ? undefined : (formData.invoice_sent || 'no'),
    };

    // Recurring: create multiple jobs
    if (scheduleType === 'recurring' && !job?.id) {
      const interval = recurringInterval === 'custom' ? parseInt(customInterval) : parseInt(recurringInterval);
      if (!interval || interval <= 0 || !repeatUntilMonth) {
        setErrors(prev => ({ ...prev, recurring: 'Please set interval and end month' }));
        return;
      }
      const dates = calculateRecurringDates(formData.scheduled_date, interval, repeatUntilMonth);
      if (dates.length === 0) {
        setErrors(prev => ({ ...prev, recurring: 'No valid dates in the selected range' }));
        return;
      }
      setIsCreatingRecurring(true);
      setRecurringProgress(`Creating ${dates.length} jobs...`);
      try {
        // Remove fields that shouldn't be passed to create
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

  const customerOptions = customers.map(c => ({
    value: c.id,
    label: c.name
      ? (c.company_name ? `${c.name} — ${c.company_name}` : c.name)
      : (c.company_name || c.business_name || '')
  }));
  const byLabel = (a, b) => (a.label || '').localeCompare(b.label || '');
  const pickupLocationOptions = pickupLocations.map(l => ({ value: l.id, label: l.name })).sort(byLabel);
  const dropOffLocationOptions = dropOffLocations.map(l => ({ value: l.id, label: l.name })).sort(byLabel);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{job?.id ? 'Edit Job' : 'Create New Job'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Job Type */}
            <div className="space-y-2">
              <Label>Job Type</Label>
              <Select value={formData.job_type} onValueChange={(v) => {
                set('job_type', v);
                set('assigned_driver_id', '');
                set('pickup_location_id', '');
                set('customer_id', '');
                set('regular_pickup_location_id', '');
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Truck Type */}
            <div className="space-y-2">
              <Label>Truck Type</Label>
              <Select value={formData.truck_type} onValueChange={(v) => { set('truck_type', v); set('delivery_yards', ''); setYardsMode('preset'); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRUCK_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Scheduled Date + Schedule Type toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{scheduleType === 'recurring' ? 'Start Date' : 'Scheduled Date'}</Label>
                {!job?.id && (
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => { setScheduleType('one_time'); setErrors(p => ({...p, recurring: ''})); }}
                      className={cn(
                        "py-0.5 px-2.5 text-[10px] font-medium rounded-l border transition-colors",
                        scheduleType === 'one_time'
                          ? "bg-amber-600 text-white border-amber-600"
                          : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      One-time
                    </button>
                    <button
                      type="button"
                      onClick={() => { setScheduleType('recurring'); setErrors(p => ({...p, recurring: ''})); }}
                      className={cn(
                        "py-0.5 px-2.5 text-[10px] font-medium rounded-r border-t border-r border-b transition-colors",
                        scheduleType === 'recurring'
                          ? "bg-amber-600 text-white border-amber-600"
                          : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      Recurring
                    </button>
                  </div>
                )}
              </div>
              <Input
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => { set('scheduled_date', e.target.value); setErrors(p => ({...p, scheduled_date: ''})); }}
                className={errors.scheduled_date ? 'border-red-500' : ''}
                required
              />
              {errors.scheduled_date && <p className="text-xs text-red-500">{errors.scheduled_date}</p>}
            </div>

            {/* Recurring options — expands when Recurring is selected */}
            {!job?.id && scheduleType === 'recurring' && (
              <div className="col-span-1 md:col-span-2 bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Repeat Every */}
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">Repeat Every</Label>
                    <Select value={recurringInterval} onValueChange={(v) => { setRecurringInterval(v); if (v !== 'custom') setCustomInterval(''); }}>
                      <SelectTrigger><SelectValue placeholder="Select interval..." /></SelectTrigger>
                      <SelectContent>
                        {intervalPresets.map(d => (
                          <SelectItem key={d} value={String(d)}>Every {d} days</SelectItem>
                        ))}
                        <SelectItem value="custom">Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                    {recurringInterval === 'custom' && (
                      <Input
                        type="number"
                        min="1"
                        placeholder="Enter days (e.g. 12)"
                        value={customInterval}
                        onChange={(e) => setCustomInterval(e.target.value)}
                        autoFocus
                      />
                    )}
                  </div>

                  {/* Repeat Until — month/year dropdown */}
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
                          const label = format(d, 'MMMM yyyy');
                          return <SelectItem key={val} value={val}>{label}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Job count preview */}
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

            {/* Invoice Required (delivery jobs only) */}
            {!isPickup && (
              <div className="space-y-2">
                <Label>Invoice Required? <span className="text-red-500">*</span></Label>
                <Select
                  value={formData.invoice_sent}
                  onValueChange={(v) => { set('invoice_sent', v); setErrors(p => ({ ...p, invoice_sent: '' })); }}
                >
                  <SelectTrigger className={errors.invoice_sent ? 'border-red-500' : (!formData.invoice_sent ? 'border-amber-400' : '')}>
                    <SelectValue placeholder="Select yes or no..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
                {errors.invoice_sent && <p className="text-xs text-red-500">{errors.invoice_sent}</p>}
              </div>
            )}

            {/* ── PICKUP LOCATION or CUSTOMER — above driver ── */}
            {isPickup ? (
              <div className="space-y-2">
                <Label>Pickup Location</Label>
                <SearchableSelect
                  value={formData.pickup_location_id}
                  onValueChange={(v) => { set('pickup_location_id', v); setErrors(p => ({...p, pickup_location_id: ''})); }}
                  options={pickupLocationOptions}
                  placeholder="Search pickup locations..."
                  error={errors.pickup_location_id}
                />
                {errors.pickup_location_id && <p className="text-xs text-red-500">{errors.pickup_location_id}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Customer</Label>
                <SearchableSelect
                  value={formData.customer_id}
                  onValueChange={(v) => { set('customer_id', v); setErrors(p => ({...p, customer_id: ''})); }}
                  options={customerOptions}
                  placeholder="Search customer..."
                  error={errors.customer_id}
                />
                {errors.customer_id && <p className="text-xs text-red-500">{errors.customer_id}</p>}
              </div>
            )}

            {/* ── ASSIGN DRIVER — below location ── */}
            {canAssign && (
              <div className="space-y-2">
                <Label>Assign Driver</Label>
                {!isPickup && invoiceRequired ? (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span className="text-xs text-amber-800">Please confirm whether an invoice is required (Yes or No) before assigning this job.</span>
                  </div>
                ) : (
                  <Select
                    value={formData.assigned_driver_id}
                    onValueChange={(v) => set('assigned_driver_id', v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select driver..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>Unassigned</SelectItem>
                      {deliveryDrivers.map(driver => (
                        <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Drop-Off Location (pickup jobs only) */}
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

            {/* Yards for pickup jobs */}
            {isPickup && (
              <div className="space-y-2">
                <Label>Yards to Collect</Label>
                {pickupYardsMode === 'preset' ? (
                  <Select
                    value={formData.pickup_yards !== '' ? String(formData.pickup_yards) : ''}
                    onValueChange={(v) => {
                      if (v === 'custom') {
                        setPickupYardsMode('custom');
                        set('pickup_yards', '');
                      } else {
                        set('pickup_yards', parseFloat(v));
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select yards..." /></SelectTrigger>
                    <SelectContent>
                      {(yardPresets[formData.truck_type] || []).map(y => (
                        <SelectItem key={y} value={String(y)}>{y} yds</SelectItem>
                      ))}
                      <SelectItem value="custom">Custom...</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder="Enter yards..."
                      value={formData.pickup_yards}
                      onChange={(e) => set('pickup_yards', e.target.value)}
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
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

            {/* Quantity — shown early for all delivery so load count is set before per-load section */}
            {!isPickup && (
              <div className="space-y-2">
                <Label>Number of Loads</Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => { set('quantity', e.target.value); setErrors(p => ({...p, quantity: ''})); }}
                  className={errors.quantity ? 'border-red-500' : ''}
                  required
                />
                {errors.quantity && <p className="text-xs text-red-500">{errors.quantity}</p>}
              </div>
            )}

            {/* Per-load pre-fill section — all delivery jobs */}
            {!isPickup && (
              <div className="col-span-1 md:col-span-2 space-y-3">
                <div>
                  <Label className="text-amber-700 font-medium">Per-Load Pickup Info</Label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {isSpreader
                      ? 'Optional — leave any field empty and the driver will fill it on their dashboard'
                      : 'Set pickup location, yards, and load configuration for each load'}
                  </p>
                </div>
                {deliveryLoads.map((load, i) => (
                  <div key={load.load_number} className="border rounded-lg p-3 space-y-3 bg-gray-50 border-gray-200">
                    <p className="text-sm font-semibold text-amber-800">Load {load.load_number}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Pickup Location <span className="text-gray-400">(optional)</span></Label>
                        <SearchableSelect
                          value={load.pickup_location_name}
                          onValueChange={(v) => {
                            const updated = [...deliveryLoads];
                            updated[i] = { ...updated[i], pickup_location_name: v };
                            setDeliveryLoads(updated);
                          }}
                          options={pickupLocations.map(l => ({ value: l.name, label: l.name })).sort(byLabel)}
                          placeholder="Search location..."
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Yards <span className="text-gray-400">(optional)</span></Label>
                        {load.yards_mode === 'preset' ? (
                          <Select
                            value={load.yards_collected !== '' ? String(load.yards_collected) : ''}
                            onValueChange={(v) => {
                              const updated = [...deliveryLoads];
                              if (v === 'custom') {
                                updated[i] = { ...updated[i], yards_mode: 'custom', yards_collected: '' };
                              } else {
                                updated[i] = { ...updated[i], yards_collected: v };
                              }
                              setDeliveryLoads(updated);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              {(yardPresets[formData.truck_type] || []).map(y => (
                                <SelectItem key={y} value={String(y)}>{y} yds</SelectItem>
                              ))}
                              <SelectItem value="custom">Custom...</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="flex gap-1">
                            <Input
                              type="number"
                              min="0"
                              step="0.5"
                              placeholder="e.g. 45"
                              value={load.yards_collected}
                              onChange={(e) => {
                                const updated = [...deliveryLoads];
                                updated[i] = { ...updated[i], yards_collected: e.target.value };
                                setDeliveryLoads(updated);
                              }}
                              className="h-8 text-xs"
                              autoFocus
                            />
                            <Button type="button" variant="outline" size="sm" className="h-8 text-xs px-2 shrink-0"
                              onClick={() => { const updated = [...deliveryLoads]; updated[i] = { ...updated[i], yards_mode: 'preset', yards_collected: '' }; setDeliveryLoads(updated); }}
                            >↩</Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">Load Configuration <span className="text-gray-400">(optional)</span></Label>
                      <Input
                        placeholder="e.g. All dry, ½ pine / ½ dry"
                        value={load.load_configuration}
                        onChange={(e) => {
                          const updated = [...deliveryLoads];
                          updated[i] = { ...updated[i], load_configuration: e.target.value };
                          setDeliveryLoads(updated);
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Quantity for pickup jobs */}
            {isPickup && (
              <div className="space-y-2">
                <Label>Number of Loads</Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => { set('quantity', e.target.value); setErrors(p => ({...p, quantity: ''})); }}
                  className={errors.quantity ? 'border-red-500' : ''}
                  required
                />
                {errors.quantity && <p className="text-xs text-red-500">{errors.quantity}</p>}
                <p className="text-xs text-gray-500">Each load will require yards entry on the job detail page</p>
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
            <div>
              {job?.id && onDelete && (
                <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(true)} className="text-red-600 border-red-300 hover:bg-red-50">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {recurringProgress && (
                <span className="text-xs text-blue-600 font-medium">{recurringProgress}</span>
              )}
              <Button type="button" variant="outline" onClick={onCancel} disabled={isCreatingRecurring}>Cancel</Button>
              <Button type="submit" disabled={isLoading || isCreatingRecurring} className="bg-amber-600 hover:bg-amber-700">
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
        </form>
      </CardContent>
    </Card>
  );
}