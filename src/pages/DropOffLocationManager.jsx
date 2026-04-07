import React, { useState } from 'react';
import { base44 } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, MapPin, Loader2, Upload } from "lucide-react";
import CsvImportModal from "@/components/admin/CsvImportModal";

function LocationForm({ location, onSubmit, onCancel, isLoading }) {
  const [form, setForm] = useState({
    name: location?.name || '',
    address: location?.address || '',
    notes: location?.notes || '',
  });

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="space-y-2">
        <Label>Location Name <span className="text-red-500">*</span></Label>
        <Input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Main Storage Yard"
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Address</Label>
        <Input
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
          placeholder="Full address"
        />
      </div>
      <div className="space-y-2">
        <Label>Notes <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
        <Textarea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Any additional notes..."
          rows={2}
        />
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isLoading} className="bg-amber-600 hover:bg-amber-700">
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {location ? 'Update Location' : 'Add Location'}
        </Button>
      </div>
    </form>
  );
}

export default function DropOffLocationManager() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);

  const DROPOFF_FIELDS = [
    { key: 'name', label: 'Location Name', required: true },
    { key: 'address', label: 'Address' },
    { key: 'notes', label: 'Notes' },
  ];

  const handleCsvImport = async (records, reportResult) => {
    let success = 0; let failed = 0;
    for (const rec of records) {
      if (!rec.name) { failed++; continue; }
      await base44.entities.DropOffLocation.create(rec);
      success++;
    }
    reportResult(success, failed);
    queryClient.invalidateQueries({ queryKey: ['dropOffLocations'] });
  };

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['dropOffLocations'],
    queryFn: () => base44.entities.DropOffLocation.list('name'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.DropOffLocation.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dropOffLocations'] }); setShowForm(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.DropOffLocation.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dropOffLocations'] }); setShowForm(false); setEditingLocation(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.DropOffLocation.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dropOffLocations'] }),
  });

  const handleSubmit = (data) => {
    if (editingLocation) {
      updateMutation.mutate({ id: editingLocation.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (loc) => {
    setEditingLocation(loc);
    setShowForm(true);
  };

  const handleDelete = (loc) => {
    if (confirm(`Permanently delete "${loc.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(loc.id);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drop-Off Locations</h1>
          <p className="text-gray-500 text-sm mt-1">Manage where John drops off sawdust after pickup</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCsvImport(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={() => { setEditingLocation(null); setShowForm(true); }} className="bg-amber-600 hover:bg-amber-700">
            <Plus className="w-4 h-4 mr-2" />
            Add Location
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
        </div>
      ) : locations.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No drop-off locations yet</p>
            <p className="text-gray-400 text-sm mt-1">Add locations where sawdust is delivered after pickup</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {locations.map(loc => (
            <Card key={loc.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                      <MapPin className="w-4 h-4 text-amber-700" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{loc.name}</p>
                      {loc.address && <p className="text-sm text-gray-500 truncate">{loc.address}</p>}
                      {loc.notes && <p className="text-xs text-gray-400 mt-1">{loc.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(loc)}>
                      <Pencil className="w-4 h-4 text-gray-500" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(loc)} disabled={deleteMutation.isPending}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CsvImportModal
        open={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        entityLabel="Drop-Off Locations"
        fields={DROPOFF_FIELDS}
        onImport={handleCsvImport}
      />

      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) setEditingLocation(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLocation ? 'Edit Drop-Off Location' : 'Add Drop-Off Location'}</DialogTitle>
          </DialogHeader>
          <LocationForm
            location={editingLocation}
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingLocation(null); }}
            isLoading={createMutation.isPending || updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}