import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/entities';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Plus, X, Truck, Save, Check } from "lucide-react";

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

export default function AppSettings() {
  const [settingsId, setSettingsId] = useState(null);
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [newYardValues, setNewYardValues] = useState({ straight_truck: '', semi: '', spreader: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedTruck, setSavedTruck] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    const results = await base44.entities.Settings.list();
    if (results.length > 0) {
      const s = results[0];
      setSettingsId(s.id);
      setPresets(s.truck_yard_presets || DEFAULT_PRESETS);
    }
    setIsLoading(false);
  };

  const savePresets = async (truckType, updatedPresets) => {
    setIsSaving(true);
    const newPresets = { ...presets, [truckType]: updatedPresets };
    setPresets(newPresets);

    if (settingsId) {
      await base44.entities.Settings.update(settingsId, { truck_yard_presets: newPresets });
    } else {
      const created = await base44.entities.Settings.create({ truck_yard_presets: newPresets });
      setSettingsId(created.id);
    }

    setSavedTruck(truckType);
    setTimeout(() => setSavedTruck(null), 2000);
    setIsSaving(false);
  };

  const addYardValue = async (truckType) => {
    const val = parseFloat(newYardValues[truckType]);
    if (!val || val <= 0) return;
    const current = presets[truckType] || [];
    if (current.includes(val)) return;
    const updated = [...current, val].sort((a, b) => a - b);
    setNewYardValues(prev => ({ ...prev, [truckType]: '' }));
    await savePresets(truckType, updated);
  };

  const removeYardValue = async (truckType, yard) => {
    const updated = (presets[truckType] || []).filter(y => y !== yard);
    await savePresets(truckType, updated);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Manage truck type yard presets for the job form.</p>
        </div>

        <div className="space-y-6">
          {TRUCK_TYPES.map(truck => {
            const yards = presets[truck.value] || [];
            const isSavedNow = savedTruck === truck.value;

            return (
              <Card key={truck.value}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-amber-600" />
                      {truck.label}
                    </div>
                    {isSavedNow && (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <Check className="w-3.5 h-3.5" /> Saved
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Current presets */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {yards.length === 0 && (
                      <p className="text-sm text-gray-400 italic">No preset values yet. Add some below.</p>
                    )}
                    {yards.map(yard => (
                      <div
                        key={yard}
                        className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-1.5 text-sm font-medium"
                      >
                        <span>{yard} yds</span>
                        <button
                          onClick={() => removeYardValue(truck.value, yard)}
                          disabled={isSaving}
                          className="text-amber-400 hover:text-red-500 transition-colors ml-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 text-gray-500 rounded-lg px-3 py-1.5 text-sm italic">
                      Custom (always available)
                    </div>
                  </div>

                  {/* Add new value */}
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="1"
                      step="0.5"
                      placeholder="Add yard value (e.g. 45)"
                      value={newYardValues[truck.value]}
                      onChange={(e) => setNewYardValues(prev => ({ ...prev, [truck.value]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addYardValue(truck.value); } }}
                      className="max-w-xs"
                    />
                    <Button
                      onClick={() => addYardValue(truck.value)}
                      disabled={isSaving || !newYardValues[truck.value]}
                      size="sm"
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      {isSaving && savedTruck === truck.value
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Plus className="w-4 h-4" />
                      }
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Press Enter or click Add. Values are saved automatically.</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}