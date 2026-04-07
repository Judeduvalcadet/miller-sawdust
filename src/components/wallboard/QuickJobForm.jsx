import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

export default function QuickJobForm({ date, drivers, customers, pickupLocations, userRole, onSave, onClose }) {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    job_type: 'delivery',
    truck_type: 'straight_truck',
    scheduled_date: date,
    customer_id: '',
    pickup_location_id: '',
    regular_pickup_location_id: '',
    quantity: 1,
    yards_collected: '',
    load_configuration: '',
    dispatcher_notes: '',
    assigned_driver_id: ''
  });

  const canAssign = userRole === 'dispatcher' || userRole === 'admin';
  const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setIsLoading(true);
    let locationData = {};

    if (formData.job_type === 'delivery') {
      const customer = customers.find(c => c.id === formData.customer_id);
      if (!customer) { setIsLoading(false); return; }
      locationData = {
        customer_id: customer.id,
        pickup_location_id: formData.regular_pickup_location_id || null,
        location_name: customer.business_name,
        address: customer.address,
        phone: customer.phone || ''
      };
    } else {
      const loc = pickupLocations.find(l => l.id === formData.pickup_location_id);
      if (!loc) { setIsLoading(false); return; }
      locationData = {
        pickup_location_id: loc.id,
        customer_id: null,
        location_name: loc.name,
        address: loc.address,
        phone: loc.phone || ''
      };
    }

    const jobData = {
      job_type: formData.job_type,
      truck_type: formData.truck_type,
      scheduled_date: formData.scheduled_date,
      quantity: parseInt(formData.quantity) || 1,
      load_configuration: formData.load_configuration || '',
      dispatcher_notes: formData.dispatcher_notes,
      status: 'pending',
      ...locationData
    };

    if (formData.job_type === 'pickup' && formData.yards_collected) {
      jobData.yards_collected = parseFloat(formData.yards_collected);
    }
    if (canAssign && formData.assigned_driver_id) {
      jobData.assigned_driver_id = formData.assigned_driver_id;
    }

    await onSave(jobData);
    setIsLoading(false);
  };

  const assignedDriver = drivers.find(d => d.id === formData.assigned_driver_id);
  const assignedPickupRole = assignedDriver?.pickup_role || 'none';
  const isJonOrJosh = assignedPickupRole === 'jon' || assignedPickupRole === 'josh';
  const pickupRoleLabel = assignedPickupRole === 'jon' ? 'Jon' : assignedPickupRole === 'josh' ? 'Josh' : '';
  const pickupDrivers = drivers.filter(d => d.role === 'driver' && (d.pickup_role === 'jon' || d.pickup_role === 'josh'));
  const deliveryDrivers = drivers.filter(d => d.role === 'driver');
  const displayDrivers = formData.job_type === 'pickup' ? pickupDrivers : deliveryDrivers;

  const filteredPickupLocations = isJohnOrJosh
    ? pickupLocations.filter(l => l.assigned_driver_name === pickupRoleLabel)
    : pickupLocations;

  // Regular driver pickup locations (not Jon/Josh assigned)
  const regularDriverPickupLocations = pickupLocations.filter(
    l => !l.assigned_driver_name || (l.assigned_driver_name !== 'Jon' && l.assigned_driver_name !== 'Josh')
  );

  // Show regular pickup location for delivery jobs where driver is NOT Josh
  const showRegularPickupLocation = formData.job_type === 'delivery' && assignedPickupRole !== 'josh';

  const customerOptions = customers.map(c => ({ value: c.id, label: c.business_name }));
  const regularPickupLocationOptions = regularDriverPickupLocations.map(l => ({ value: l.id, label: l.name }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            New Job – {format(parseISO(date), 'EEEE, MMM d')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Job Type</Label>
              <Select value={formData.job_type} onValueChange={v => {
                set('job_type', v);
                set('regular_pickup_location_id', '');
                set('pickup_location_id', '');
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Truck Type</Label>
              <Select value={formData.truck_type} onValueChange={v => set('truck_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="straight_truck">Straight Truck</SelectItem>
                  <SelectItem value="semi">Semi Truck</SelectItem>
                  <SelectItem value="spreader">Spreader</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Customer (delivery) or Pickup Location (pickup) */}
          {formData.job_type === 'delivery' ? (
            <div className="space-y-1">
              <Label>Customer</Label>
              <SearchableSelect
                value={formData.customer_id}
                onValueChange={v => set('customer_id', v)}
                options={customerOptions}
                placeholder="Search customer..."
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Pickup Location {isJonOrJosh ? `(${pickupRoleLabel}'s)` : ''}</Label>
              <Select value={formData.pickup_location_id} onValueChange={v => set('pickup_location_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder={isJonOrJosh ? `${pickupRoleLabel}'s locations...` : 'Select driver first...'} />
                </SelectTrigger>
                <SelectContent>
                  {filteredPickupLocations.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                  {filteredPickupLocations.length === 0 && (
                    <SelectItem value={null} disabled>
                      {isJonOrJosh ? `No locations for ${pickupRoleLabel}` : 'Select a pickup driver first'}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Regular driver pickup location (delivery, not Josh) */}
          {showRegularPickupLocation && (
            <div className="space-y-1">
              <Label>Pickup Location <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
              <SearchableSelect
                value={formData.regular_pickup_location_id}
                onValueChange={v => set('regular_pickup_location_id', v)}
                options={regularPickupLocationOptions}
                placeholder="Search pickup location..."
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Quantity (Loads)</Label>
              <Input
                type="number"
                min="1"
                value={formData.quantity}
                onChange={e => set('quantity', e.target.value)}
              />
            </div>
            {formData.job_type === 'pickup' ? (
              <div className="space-y-1">
                <Label>Est. Yards</Label>
                <Input
                  type="number"
                  placeholder="e.g. 120"
                  value={formData.yards_collected}
                  onChange={e => set('yards_collected', e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Load Configuration</Label>
                <Input
                  placeholder="e.g. 1/3 Pine 2/3 Dry"
                  value={formData.load_configuration}
                  onChange={e => set('load_configuration', e.target.value)}
                />
              </div>
            )}
          </div>

          {canAssign && (
            <div className="space-y-1">
              <Label>Assign Driver (optional)</Label>
              <Select value={formData.assigned_driver_id} onValueChange={v => {
                set('assigned_driver_id', v);
                set('pickup_location_id', '');
              }}>
                <SelectTrigger><SelectValue placeholder="Assign later..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Unassigned</SelectItem>
                  {displayDrivers.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              placeholder="Add notes for the driver..."
              value={formData.dispatcher_notes}
              onChange={e => set('dispatcher_notes', e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={isLoading} className="bg-amber-600 hover:bg-amber-700">
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}