import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// Simple CSV parser — handles quoted fields
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseRow = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(parseRow);
  return { headers, rows };
}

/**
 * CsvImportModal
 *
 * Props:
 *   open          - boolean
 *   onClose       - fn()
 *   entityLabel   - string, e.g. "Customers"
 *   fields        - [{ key, label, required? }]
 *   onImport      - async fn(records, onProgress)
 *                   onProgress({ current, total, success, failed, errors }) called after each record
 *   transformRow  - optional fn(mappedRow) => object
 */
export default function CsvImportModal({ open, onClose, entityLabel, fields, onImport, transformRow }) {
  const fileInputRef = useRef(null);
  const cancelledRef = useRef(false);
  const [step, setStep] = useState('upload'); // upload | mapping | importing | result
  const [csvData, setCsvData] = useState(null);
  const [mapping, setMapping] = useState({});
  const [progress, setProgress] = useState({ current: 0, total: 0, success: 0, failed: 0, errors: [] });

  const reset = () => {
    cancelledRef.current = false;
    setStep('upload');
    setCsvData(null);
    setMapping({});
    setProgress({ current: 0, total: 0, success: 0, failed: 0, errors: [] });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCsv(ev.target.result);
      if (!parsed.headers.length) return;
      const autoMap = {};
      parsed.headers.forEach(h => {
        const hLow = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Prioritize exact matches first, then fall back to partial
        const exactMatch = fields.find(f => {
          const fKey = f.key.toLowerCase().replace(/[^a-z0-9]/g, '');
          const fLabel = f.label.toLowerCase().replace(/[^a-z0-9]/g, '');
          return fKey === hLow || fLabel === hLow;
        });
        const partialMatch = !exactMatch && fields.find(f => {
          const fKey = f.key.toLowerCase().replace(/[^a-z0-9]/g, '');
          const fLabel = f.label.toLowerCase().replace(/[^a-z0-9]/g, '');
          return fLabel.includes(hLow) || hLow.includes(fKey);
        });
        const match = exactMatch || partialMatch;
        if (match) autoMap[h] = match.key;
      });
      setCsvData(parsed);
      setMapping(autoMap);
      setStep('mapping');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    const records = csvData.rows.map(row => {
      const obj = {};
      csvData.headers.forEach((h, i) => {
        const fieldKey = mapping[h];
        if (fieldKey) obj[fieldKey] = row[i] || '';
      });
      return transformRow ? transformRow(obj) : obj;
    }).filter(r => Object.keys(r).length > 0);

    cancelledRef.current = false;
    const initialProgress = { current: 0, total: records.length, success: 0, failed: 0, errors: [] };
    setProgress(initialProgress);
    setStep('importing');

    await onImport(records, (prog) => {
      setProgress({ ...prog });
      return cancelledRef.current; // signal cancellation to onImport
    });

    setStep('result');
  };

  const usedFields = new Set(Object.values(mapping));
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={step === 'importing' ? undefined : handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-600" />
            Import {entityLabel} from CSV
          </DialogTitle>
        </DialogHeader>

        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <div className="py-6">
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-amber-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">Click to upload a CSV file</p>
              <p className="text-sm text-gray-400 mt-1">First row must be column headers</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>
        )}

        {/* STEP 2: Mapping */}
        {step === 'mapping' && csvData && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-500">
              Found <strong>{csvData.rows.length}</strong> rows and <strong>{csvData.headers.length}</strong> columns.
              Map each CSV column to a system field below.
            </p>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">CSV Column</th>
                    <th className="px-2 py-2 text-center text-gray-400">→</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">System Field</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 hidden sm:table-cell">Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {csvData.headers.map(h => (
                    <tr key={h} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800">{h}</td>
                      <td className="px-2 py-2 text-center text-gray-300">→</td>
                      <td className="px-4 py-2">
                        <Select
                          value={mapping[h] || '__skip__'}
                          onValueChange={(v) => {
                            setMapping(prev => {
                              const next = { ...prev };
                              if (v === '__skip__') delete next[h];
                              else next[h] = v;
                              return next;
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__skip__">
                              <span className="text-gray-400 italic">Skip this column</span>
                            </SelectItem>
                            {fields.map(f => (
                              <SelectItem
                                key={f.key}
                                value={f.key}
                                disabled={usedFields.has(f.key) && mapping[h] !== f.key}
                              >
                                {f.label}{f.required ? ' *' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs hidden sm:table-cell truncate max-w-[120px]">
                        {csvData.rows[0]?.[csvData.headers.indexOf(h)] || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {fields.filter(f => f.required && !usedFields.has(f.key)).length > 0 && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Required fields not yet mapped:{' '}
                  <strong>{fields.filter(f => f.required && !usedFields.has(f.key)).map(f => f.label).join(', ')}</strong>
                </span>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Importing (live progress) */}
        {step === 'importing' && (
          <div className="py-8 space-y-5">
            <div className="text-center space-y-1">
              <Loader2 className="w-10 h-10 text-amber-500 mx-auto animate-spin" />
              <p className="text-lg font-semibold text-gray-800 mt-3">Importing...</p>
              <p className="text-2xl font-bold text-amber-600">
                {progress.current} <span className="text-gray-400 text-lg font-normal">of</span> {progress.total}
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div
                className="bg-amber-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Live counts */}
            <div className="flex justify-center gap-6 text-sm">
              <span className="text-green-600 font-medium">✓ {progress.success} succeeded</span>
              {progress.failed > 0 && (
                <span className="text-red-500 font-medium">✗ {progress.failed} failed</span>
              )}
            </div>
          </div>
        )}

        {/* STEP 4: Result */}
        {step === 'result' && (
          <div className="space-y-4 py-4">
            <div className="text-center space-y-2">
              {progress.failed === 0 ? (
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              ) : (
                <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
              )}
              <p className="text-lg font-semibold text-gray-800">Import Complete</p>
              <p className="text-gray-500">
                <span className="text-green-600 font-medium">{progress.success} record{progress.success !== 1 ? 's' : ''}</span> imported successfully
                {progress.failed > 0 && (
                  <span className="text-red-500"> · {progress.failed} failed</span>
                )}
              </p>
            </div>

            {progress.errors?.length > 0 && (
              <div className="border border-red-200 rounded-lg overflow-hidden">
                <div className="bg-red-50 px-4 py-2 border-b border-red-200">
                  <p className="text-sm font-medium text-red-700">Failed Records</p>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-red-100">
                  {progress.errors.map((err, i) => (
                    <div key={i} className="px-4 py-2 text-sm">
                      <span className="font-medium text-gray-700">Row {err.rowIndex + 1}:</span>
                      {' '}
                      <span className="text-red-600">{err.reason}</span>
                      {err.preview && (
                        <span className="text-gray-400 ml-2 text-xs">({err.preview})</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button
                onClick={handleImport}
                disabled={Object.keys(mapping).length === 0}
                className="bg-amber-600 hover:bg-amber-700"
              >
                Import {csvData?.rows.length} Records
              </Button>
            </>
          )}
          {step === 'importing' && (
            <>
              <Button
                variant="outline"
                onClick={() => { cancelledRef.current = true; }}
              >
                Cancel
              </Button>
              <Button disabled className="bg-amber-600">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </Button>
            </>
          )}
          {step === 'result' && (
            <>
              <Button variant="outline" onClick={reset}>Import Another</Button>
              <Button onClick={handleClose} className="bg-amber-600 hover:bg-amber-700">Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}