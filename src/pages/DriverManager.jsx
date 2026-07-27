import React, { useState } from 'react';
import { base44 } from '@/api/entities';
import { setPin } from '@/api/authClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { 
  Plus, User, Phone, Key, Edit, Trash2, 
  UserCheck, UserX, Loader2, ArrowLeft, Upload
} from "lucide-react";
import CsvImportModal from "@/components/admin/CsvImportModal";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function DriverManager() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [editingDriver, setEditingDriver] = useState(null);
  const [showPinReset, setShowPinReset] = useState(false);

  const DRIVER_FIELDS = [
    { key: 'name', label: 'Full Name', required: true },
    { key: 'username', label: 'Username', required: true },
    { key: 'phone', label: 'Phone' },
    { key: 'pin', label: 'PIN (4-6 digits)' },
    { key: 'role', label: 'Role (driver/dispatcher/admin)' },
  ];

  const handleCsvImport = async (records, reportResult) => {
    let success = 0; let failed = 0;
    for (const rec of records) {
      if (!rec.name || !rec.username) { failed++; continue; }
      const data = {
        name: rec.name,
        username: rec.username,
        phone: rec.phone || '',
        role: rec.role || 'driver',
        driver_type: 'delivery',
        pickup_role: 'none',
        active: true,
      };
      const created = await base44.entities.Driver.create(data);
      await setPin(created.id, rec.pin || '0000');
      success++;
    }
    reportResult(success, failed);
    queryClient.invalidateQueries({ queryKey: ['drivers'] });
  };
  const [resetPinDriver, setResetPinDriver] = useState(null);
  const [newPin, setNewPin] = useState('');
  
  const [formData, setFormData] = useState({
    username: '',
    name: '',
    phone: '',
    pin: '',
    role: 'driver',
    driver_type: 'delivery',
    pickup_role: 'none',
    active: true
  });

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => base44.entities.Driver.list('-created_date'),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const createMutation = useMutation({
    mutationFn: async ({ data, pin }) => {
      const created = await base44.entities.Driver.create(data);
      if (pin) await setPin(created.id, pin);
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      setShowForm(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, pin }) => {
      const updated = await base44.entities.Driver.update(id, data);
      if (pin) await setPin(id, pin);
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      setShowForm(false);
      setEditingDriver(null);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Driver.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    }
  });

  const resetForm = () => {
    setFormData({
      username: '',
      name: '',
      phone: '',
      pin: '',
      role: 'driver',
      driver_type: 'delivery',
      pickup_role: 'none',
      active: true
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const data = {
      username: formData.username,
      name: formData.name,
      phone: formData.phone,
      role: formData.role,
      driver_type: formData.driver_type,
      pickup_role: formData.pickup_role || 'none',
      active: formData.active
    };

    if (editingDriver) {
      updateMutation.mutate({ id: editingDriver.id, data, pin: formData.pin });
    } else {
      createMutation.mutate({ data, pin: formData.pin });
    }
  };

  const handleEdit = (driver) => {
    setEditingDriver(driver);
    setFormData({
      username: driver.username,
      name: driver.name,
      phone: driver.phone || '',
      pin: '',
      role: driver.role,
      driver_type: driver.driver_type || 'delivery',
      pickup_role: driver.pickup_role || 'none',
      active: driver.active
    });
    setShowForm(true);
  };

  const handleToggleActive = async (driver) => {
    await base44.entities.Driver.update(driver.id, { active: !driver.active });
    queryClient.invalidateQueries({ queryKey: ['drivers'] });
  };

  const handleResetPin = async () => {
    if (newPin.length < 4) return;
    await setPin(resetPinDriver.id, newPin);
    setShowPinReset(false);
    setResetPinDriver(null);
    setNewPin('');
    queryClient.invalidateQueries({ queryKey: ['drivers'] });
  };

  const handleDelete = async (driver) => {
    if (confirm(`Permanently delete ${driver.name}? This cannot be undone.`)) {
      deleteMutation.mutate(driver.id);
    }
  };

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
              <h1 className="font-bold text-xl">User Manager</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowCsvImport(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </Button>
              <Button 
                onClick={() => {
                  setEditingDriver(null);
                  resetForm();
                  setShowForm(true);
                }}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add User
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
          </div>
        ) : (
          <div className="grid gap-4">
            {drivers.map(driver => (
              <Card key={driver.id} className={!driver.active ? 'opacity-60' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        driver.active ? 'bg-amber-100' : 'bg-gray-100'
                      }`}>
                        <User className={`w-6 h-6 ${driver.active ? 'text-amber-600' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{driver.name}</h3>
                          <Badge variant="outline" className="text-xs">
                            @{driver.username}
                          </Badge>
                          <Badge className={
                            driver.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                            driver.role === 'dispatcher' ? 'bg-blue-100 text-blue-700' :
                            driver.role === 'scheduler' ? 'bg-green-100 text-green-700' :
                            driver.role === 'assistant' ? 'bg-pink-100 text-pink-700' :
                            'bg-gray-100 text-gray-700'
                          }>
                            {driver.role}
                          </Badge>
                          {driver.role === 'driver' && driver.driver_type && (
                            <Badge className={
                              driver.driver_type === 'pickup'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-sky-100 text-sky-700'
                            }>
                              {driver.driver_type === 'pickup' ? 'Pickup' : 'Delivery'}
                            </Badge>
                          )}
                        </div>
                        {driver.phone && (
                          <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                            <Phone className="w-3 h-3" />
                            {driver.phone}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setResetPinDriver(driver);
                          setShowPinReset(true);
                        }}
                        title="Reset PIN"
                      >
                        <Key className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleActive(driver)}
                        title={driver.active ? 'Deactivate' : 'Activate'}
                      >
                        {driver.active ? (
                          <UserCheck className="w-4 h-4 text-green-600" />
                        ) : (
                          <UserX className="w-4 h-4 text-gray-400" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(driver)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(driver)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {drivers.length === 0 && (
              <div className="text-center py-12">
                <User className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No drivers yet</p>
              </div>
            )}
          </div>
        )}
      </div>

      <CsvImportModal
        open={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        entityLabel="Users"
        fields={DRIVER_FIELDS}
        onImport={handleCsvImport}
      />

      {/* Add/Edit Driver Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDriver ? 'Edit User' : 'Add New User'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  value={formData.username}
                  onChange={(e) => setFormData({...formData, username: e.target.value})}
                  placeholder="jsmith"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="John Smith"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  placeholder="555-123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label>{editingDriver ? 'New PIN (leave blank to keep)' : 'PIN'}</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={formData.pin}
                  onChange={(e) => setFormData({...formData, pin: e.target.value.replace(/\D/g, '')})}
                  placeholder="4-6 digits"
                  required={!editingDriver}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select 
                  value={formData.role} 
                  onValueChange={(v) => setFormData({...formData, role: v})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="driver">Driver</SelectItem>
                    <SelectItem value="dispatcher">Dispatcher</SelectItem>
                    <SelectItem value="scheduler">Scheduler</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="assistant">Assistant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.role === 'driver' && (
                <div className="space-y-2">
                  <Label>Driver Type</Label>
                  <Select
                    value={formData.driver_type}
                    onValueChange={(v) => setFormData({...formData, driver_type: v})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="delivery">Delivery Driver</SelectItem>
                      <SelectItem value="pickup">Pickup Driver (yards)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {formData.role === 'driver' && (
                <div className="space-y-2">
                  <Label>Driver Setting</Label>
                  <Select
                    value={formData.pickup_role}
                    onValueChange={(v) => setFormData({...formData, pickup_role: v})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="jon">Jon</SelectItem>
                      <SelectItem value="josh">Josh</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">Controls pickup location filtering and yard logic</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="flex items-center gap-3 h-10">
                  <Switch
                    checked={formData.active}
                    onCheckedChange={(v) => setFormData({...formData, active: v})}
                  />
                  <span className="text-sm">{formData.active ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
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
                {editingDriver ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset PIN Dialog */}
      <Dialog open={showPinReset} onOpenChange={setShowPinReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset PIN for {resetPinDriver?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>New PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 4-6 digit PIN"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinReset(false)}>
              Cancel
            </Button>
            <Button onClick={handleResetPin} disabled={newPin.length < 4}>
              Reset PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}