import React, { useState } from 'react';
import { base44 } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Plus, Factory, Phone, MapPin, Edit, Trash2, 
  Loader2, ArrowLeft, Search, Upload
} from "lucide-react";
import CsvImportModal from "@/components/admin/CsvImportModal";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const DRIVER_OPTIONS = [
  { value: 'jon', label: 'John' },
  { value: 'josh', label: 'Josh' },
  { value: 'other_drivers', label: 'Other Drivers' },
];

const LOCATION_TYPE_LABELS = {
  supplier: 'Supplier',
  my_building: 'MS Location',
};

function AssignedDriverBadges({ assigned_drivers }) {
  if (!assigned_drivers || assigned_drivers.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {assigned_drivers.map(d => {
        const opt = DRIVER_OPTIONS.find(o => o.value === d);
        return (
          <span key={d} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            {opt?.label || d}
          </span>
        );
      })}
    </div>
  );
}

const emptyForm = {
  name: '',
  phone: '',
  address: '',
  assigned_drivers: [],
  location_type: 'supplier',
};

export default function PickupLocationManager() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState(emptyForm);

  const PICKUP_FIELDS = [
    { key: 'name', label: 'Location Name', required: true },
    { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address', required: true },
  ];

  const handleCsvImport = async (records, reportResult) => {
    let success = 0; let failed = 0;
    for (const rec of records) {
      if (!rec.name || !rec.address) { failed++; continue; }
      await base44.entities.PickupLocation.create({ ...rec, location_type: 'supplier', assigned_drivers: [] });
      success++;
    }
    reportResult(success, failed);
    queryClient.invalidateQueries({ queryKey: ['pickupLocations'] });
  };

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['pickupLocations'],
    queryFn: () => base44.entities.PickupLocation.list('name'),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.PickupLocation.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickupLocations'] });
      setShowForm(false);
      setFormData(emptyForm);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PickupLocation.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickupLocations'] });
      setShowForm(false);
      setEditingLocation(null);
      setFormData(emptyForm);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PickupLocation.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pickupLocations'] })
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingLocation) {
      updateMutation.mutate({ id: editingLocation.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (location) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      phone: location.phone || '',
      address: location.address,
      assigned_drivers: location.assigned_drivers || [],
      location_type: location.location_type || 'supplier',
    });
    setShowForm(true);
  };

  const handleDelete = (location) => {
    if (confirm(`Permanently delete "${location.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(location.id);
    }
  };

  const toggleDriver = (value) => {
    setFormData(prev => {
      const current = prev.assigned_drivers || [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, assigned_drivers: next };
    });
  };

  const filteredLocations = locations.filter(l =>
    l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.address?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to={createPageUrl('AdminDashboard')}>
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <h1 className="font-bold text-xl">Pickup Locations</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowCsvImport(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </Button>
              <Button
                onClick={() => {
                  setEditingLocation(null);
                  setFormData(emptyForm);
                  setShowForm(true);
                }}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Location
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredLocations.map(location => (
              <Card key={location.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                        <Factory className="w-6 h-6 text-amber-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{location.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            location.location_type === 'my_building'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {LOCATION_TYPE_LABELS[location.location_type] || 'Supplier'}
                          </span>
                        </div>
                        <AssignedDriverBadges assigned_drivers={location.assigned_drivers} />
                        {location.phone && (
                          <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                            <Phone className="w-3 h-3" />
                            {location.phone}
                          </p>
                        )}
                        <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                          <MapPin className="w-3 h-3" />
                          {location.address}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(location)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(location)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredLocations.length === 0 && (
              <div className="text-center py-12">
                <Factory className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No pickup locations found</p>
              </div>
            )}
          </div>
        )}
      </div>

      <CsvImportModal
        open={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        entityLabel="Pickup Locations"
        fields={PICKUP_FIELDS}
        onImport={handleCsvImport}
      />

      {/* Add/Edit Location Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLocation ? 'Edit Location' : 'Add New Location'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Sawmill Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="Oak Valley Sawmill"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                placeholder="555-123-4567"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                placeholder="456 Mill Lane, Milltown, PA 12345"
                required
              />
            </div>

            {/* Multi-select: Assigned To */}
            <div className="space-y-2">
              <Label>Assigned To</Label>
              <div className="flex flex-col gap-2 border rounded-md p-3">
                {DRIVER_OPTIONS.map(opt => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`driver-${opt.value}`}
                      checked={(formData.assigned_drivers || []).includes(opt.value)}
                      onCheckedChange={() => toggleDriver(opt.value)}
                    />
                    <label htmlFor={`driver-${opt.value}`} className="text-sm cursor-pointer">
                      {opt.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Location Type */}
            <div className="space-y-2">
              <Label>Location Type</Label>
              <Select
                value={formData.location_type}
                onValueChange={(v) => setFormData({...formData, location_type: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supplier">Supplier</SelectItem>
                  <SelectItem value="my_building">MS Location</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {editingLocation ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}