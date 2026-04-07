import React, { useState, useRef } from 'react';
import { base44 } from '@/api/entities';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Download, Upload, Loader2, CheckCircle2, AlertCircle, Database, TriangleAlert } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const ENTITIES = [
  'Customer', 'Job', 'Driver', 'PickupLocation',
  'DropOffLocation', 'DriverSession', 'DriverNotification', 'Settings', 'LogEntry'
];

export default function BackupRestore() {
  const fileInputRef = useRef(null);

  // Backup state
  const [backupStatus, setBackupStatus] = useState('idle');
  const [backupProgress, setBackupProgress] = useState([]);

  // Restore state
  const [restoreStatus, setRestoreStatus] = useState('idle'); // idle | confirm | running | done | error
  const [restoreProgress, setRestoreProgress] = useState([]);
  const [backupFile, setBackupFile] = useState(null); // parsed JSON
  const [restoreError, setRestoreError] = useState('');

  // ── BACKUP ──────────────────────────────────────────────
  const handleBackup = async () => {
    setBackupStatus('running');
    setBackupProgress([]);
    const backup = { exported_at: new Date().toISOString(), entities: {} };

    for (const entity of ENTITIES) {
      setBackupProgress(prev => [...prev, { entity, status: 'loading' }]);
      try {
        const records = await base44.entities[entity].list(undefined, 5000);
        backup.entities[entity] = records;
        setBackupProgress(prev => prev.map(p => p.entity === entity ? { ...p, status: 'done', count: records.length } : p));
      } catch (e) {
        setBackupProgress(prev => prev.map(p => p.entity === entity ? { ...p, status: 'error', error: e.message } : p));
      }
    }

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `miller_sawdust_backup_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupStatus('done');
  };

  // ── RESTORE ─────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.entities) throw new Error('Invalid backup file — missing entities key.');
        setBackupFile(parsed);
        setRestoreStatus('confirm');
        setRestoreError('');
      } catch (err) {
        setRestoreError(err.message);
        setRestoreStatus('error');
      }
    };
    reader.readAsText(file);
  };

  const handleRestore = async () => {
    setRestoreStatus('running');
    setRestoreProgress([]);

    for (const entity of ENTITIES) {
      const records = backupFile.entities[entity];
      if (!records || records.length === 0) {
        setRestoreProgress(prev => [...prev, { entity, status: 'skipped', count: 0 }]);
        continue;
      }

      setRestoreProgress(prev => [...prev, { entity, status: 'loading' }]);
      try {
        // Strip built-in read-only fields before re-inserting
        const clean = records.map(({ id, created_date, updated_date, created_by, ...rest }) => rest);
        const CHUNK = 50;
        for (let i = 0; i < clean.length; i += CHUNK) {
          await base44.entities[entity].bulkCreate(clean.slice(i, i + CHUNK));
        }
        setRestoreProgress(prev => prev.map(p => p.entity === entity ? { ...p, status: 'done', count: records.length } : p));
      } catch (e) {
        setRestoreProgress(prev => prev.map(p => p.entity === entity ? { ...p, status: 'error', error: e.message } : p));
      }
    }

    setRestoreStatus('done');
  };

  const resetRestore = () => {
    setRestoreStatus('idle');
    setRestoreProgress([]);
    setBackupFile(null);
    setRestoreError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const totalRecords = backupFile
    ? Object.values(backupFile.entities).reduce((sum, arr) => sum + (arr?.length || 0), 0)
    : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to={createPageUrl('AdminDashboard')}>
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <Database className="w-5 h-5 text-amber-600" />
          <h1 className="font-bold text-xl">System Backup & Restore</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* ── BACKUP CARD ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="w-4 h-4 text-amber-600" /> Export Backup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-500">
              Downloads a complete snapshot of all system data as a <strong>.json</strong> file. Store it somewhere safe before making any big changes.
            </p>

            {backupStatus === 'idle' && (
              <Button onClick={handleBackup} className="bg-amber-600 hover:bg-amber-700 w-full">
                <Download className="w-4 h-4 mr-2" /> Download Full Backup
              </Button>
            )}

            {(backupStatus === 'running' || backupStatus === 'done') && (
              <div className="space-y-3">
                {backupStatus === 'running' && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm font-medium">
                    <Loader2 className="w-4 h-4 animate-spin" /> Exporting data...
                  </div>
                )}
                {backupStatus === 'done' && (
                  <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
                    <CheckCircle2 className="w-4 h-4" /> Backup downloaded successfully!
                  </div>
                )}
                <div className="border rounded-lg divide-y text-sm">
                  {backupProgress.map(({ entity, status: s, count, error }) => (
                    <div key={entity} className="flex items-center justify-between px-4 py-2">
                      <span className="font-medium text-gray-700">{entity}</span>
                      <span>
                        {s === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />}
                        {s === 'done' && <span className="text-green-600">{count} records ✓</span>}
                        {s === 'error' && <span className="text-red-500 text-xs">{error}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                {backupStatus === 'done' && (
                  <Button onClick={() => { setBackupStatus('idle'); setBackupProgress([]); }} variant="outline" className="w-full">
                    Download Again
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── RESTORE CARD ── */}
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="w-4 h-4 text-orange-500" /> Restore from Backup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm text-orange-800">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span><strong>Warning:</strong> Restoring will <strong>add</strong> records from the backup on top of existing data. It will not delete current records. To avoid duplicates, only restore entities that are missing.</span>
            </div>

            {restoreStatus === 'idle' && (
              <>
                <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
                <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="w-full border-orange-300 text-orange-700 hover:bg-orange-50">
                  <Upload className="w-4 h-4 mr-2" /> Select Backup File (.json)
                </Button>
              </>
            )}

            {restoreStatus === 'error' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4" /> {restoreError}
                </div>
                <Button onClick={resetRestore} variant="outline" className="w-full">Try Again</Button>
              </div>
            )}

            {restoreStatus === 'confirm' && backupFile && (
              <div className="space-y-3">
                <div className="border rounded-lg divide-y text-sm">
                  <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 font-medium">
                    Backup from: {new Date(backupFile.exported_at).toLocaleString()} · {totalRecords.toLocaleString()} total records
                  </div>
                  {ENTITIES.map(entity => {
                    const count = backupFile.entities[entity]?.length || 0;
                    return (
                      <div key={entity} className="flex items-center justify-between px-4 py-2">
                        <span className="font-medium text-gray-700">{entity}</span>
                        <span className="text-gray-500">{count} records</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <Button onClick={resetRestore} variant="outline" className="flex-1">Cancel</Button>
                  <Button onClick={handleRestore} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white">
                    Restore All Data
                  </Button>
                </div>
              </div>
            )}

            {(restoreStatus === 'running' || restoreStatus === 'done') && (
              <div className="space-y-3">
                {restoreStatus === 'running' && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm font-medium">
                    <Loader2 className="w-4 h-4 animate-spin" /> Restoring data...
                  </div>
                )}
                {restoreStatus === 'done' && (
                  <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
                    <CheckCircle2 className="w-4 h-4" /> Restore complete!
                  </div>
                )}
                <div className="border rounded-lg divide-y text-sm">
                  {restoreProgress.map(({ entity, status: s, count, error }) => (
                    <div key={entity} className="flex items-center justify-between px-4 py-2">
                      <span className="font-medium text-gray-700">{entity}</span>
                      <span>
                        {s === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />}
                        {s === 'done' && <span className="text-green-600">{count} records restored ✓</span>}
                        {s === 'skipped' && <span className="text-gray-400">empty — skipped</span>}
                        {s === 'error' && <span className="text-red-500 text-xs">{error}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                {restoreStatus === 'done' && (
                  <Button onClick={resetRestore} variant="outline" className="w-full">Restore Another File</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}