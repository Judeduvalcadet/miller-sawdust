import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/entities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  Plus, Building2, Phone, MapPin, Edit2, Trash2, 
  Loader2, ArrowLeft, Search, Upload, Download, X, Pencil, ImagePlus, RefreshCw
} from "lucide-react";
import CsvImportModal from "@/components/admin/CsvImportModal";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from 'sonner';

const EMPTY_FORM = {
  name: '', company_name: '', street_address: '',
  city: '', state: '', country: '', zip_code: '', phone: '',
  map_image_url: '', delivery_instructions: ''
};

const CUSTOMER_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'company_name', label: 'Company Name' },
  { key: 'street_address', label: 'Street Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'zip_code', label: 'Zip Code' },
  { key: 'phone', label: 'Phone' },
];

function buildAddress(c) {
  const stateZip = [c.state, c.zip_code].filter(Boolean).join(' ');
  return [c.street_address, c.city, stateZip, c.country].filter(Boolean).join(', ');
}

export default function CustomerManager() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [isRelinking, setIsRelinking] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list('name'),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customers'] });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (editingCustomer) {
      await base44.entities.Customer.update(editingCustomer.id, formData);
    } else {
      await base44.entities.Customer.create(formData);
    }
    invalidate();
    setShowForm(false);
    setEditingCustomer(null);
    setFormData(EMPTY_FORM);
  };

  const [uploadingImage, setUploadingImage] = useState(false);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    set('map_image_url', file_url);
    setUploadingImage(false);
  };

  const handleEdit = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      company_name: customer.company_name || '',
      street_address: customer.street_address || '',
      city: customer.city || '',
      state: customer.state || '',
      country: customer.country || '',
      zip_code: customer.zip_code || '',
      phone: customer.phone || '',
      map_image_url: customer.map_image_url || '',
      delivery_instructions: customer.delivery_instructions || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (customer) => {
    if (confirm(`Delete "${customer.name || 'this customer'}"? This cannot be undone.`)) {
      await base44.entities.Customer.delete(customer.id);
      invalidate();
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Permanently delete ${selectedIds.size} customer(s)? This cannot be undone.`)) return;
    setIsBusy(true);
    for (const id of selectedIds) {
      await base44.entities.Customer.delete(id);
    }
    setSelectedIds(new Set());
    setSelectMode(false);
    setIsBusy(false);
    invalidate();
  };

  const handleCsvImport = async (records, onProgress) => {
    // Build a set of existing customer names (lowercase) for dedup
    const existingNames = new Set(customers.map(c => (c.name || '').toLowerCase().trim()));

    let success = 0; let failed = 0; const errors = [];
    const CHUNK_SIZE = 50;

    // Split into new vs duplicate before we start
    const newRecords = [];
    records.forEach((rec, i) => {
      if (!rec.name || !rec.name.trim()) {
        failed++;
        errors.push({ rowIndex: i, reason: 'Name is required', preview: Object.values(rec).filter(Boolean).join(', ').slice(0, 40) || 'empty row' });
      } else if (existingNames.has(rec.name.toLowerCase().trim())) {
        failed++;
        errors.push({ rowIndex: i, reason: `Already exists — skipped`, preview: rec.name });
      } else {
        newRecords.push({ rec, originalIndex: i });
      }
    });

    for (let i = 0; i < newRecords.length; i += CHUNK_SIZE) {
      const chunk = newRecords.slice(i, i + CHUNK_SIZE).map(x => x.rec);
      await base44.entities.Customer.bulkCreate(chunk);
      success += chunk.length;

      const cancelled = onProgress({
        current: Math.min(i + CHUNK_SIZE, newRecords.length) + (records.length - newRecords.length - (records.length - newRecords.length - failed + failed)),
        total: records.length,
        success,
        failed,
        errors,
      });
      if (cancelled) break;
    }

    // Final progress tick
    onProgress({ current: records.length, total: records.length, success, failed, errors });
    invalidate();
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allPageSelected) {
      // Deselect current page
      setSelectedIds(prev => {
        const next = new Set(prev);
        pagedCustomers.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      // Select current page
      setSelectedIds(prev => {
        const next = new Set(prev);
        pagedCustomers.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  const handleRelinkJobs = async () => {
    setIsRelinking(true);
    const res = await base44.functions.invoke('relinkJobsToCustomers', {});
    setIsRelinking(false);
    const { relinked, unmatched, unmatchedNames } = res.data;
    toast({
      title: `Re-link complete`,
      description: relinked > 0
        ? `${relinked} job(s) re-linked.${unmatched > 0 ? ` ${unmatched} could not be matched: ${unmatchedNames.slice(0,5).join(', ')}` : ''}`
        : unmatched > 0
          ? `No jobs could be re-linked. Unmatched: ${unmatchedNames.slice(0,5).join(', ')}`
          : 'All jobs already have valid customer links.',
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // Search across ALL records, not just current page
  const filteredCustomers = customers.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.company_name || '').toLowerCase().includes(q) ||
      buildAddress(c).toLowerCase().includes(q)
    );
  });

  // Reset to page 1 when search changes
  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()); }, [searchQuery]);
  useEffect(() => { setCurrentPage(1); }, [pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
  const pagedCustomers = filteredCustomers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleExportCsv = () => {
    const headers = ['Name', 'Company Name', 'Street Address', 'City', 'State', 'Zip Code', 'Country', 'Phone', 'Delivery Instructions'];
    const rows = customers.map(c => [
      c.name || '',
      c.company_name || '',
      c.street_address || '',
      c.city || '',
      c.state || '',
      c.zip_code || '',
      c.country || '',
      c.phone || '',
      c.delivery_instructions || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // "Select All" selects current page only
  const allPageSelected = pagedCustomers.length > 0 && pagedCustomers.every(c => selectedIds.has(c.id));
  const allSelected = allPageSelected;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to={createPageUrl('AdminDashboard')}>
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <h1 className="font-bold text-xl">Customers</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRelinkJobs} disabled={isRelinking}>
                {isRelinking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Re-link Jobs
              </Button>
              <Button variant="outline" onClick={handleExportCsv}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" onClick={() => setShowCsvImport(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </Button>
              <Button
                onClick={() => { setEditingCustomer(null); setFormData(EMPTY_FORM); setShowForm(true); }}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Customer
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Search row */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex-1" />

          {/* Select mode toggle / actions */}
          {!selectMode ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 shrink-0">
                {searchQuery
                  ? <><strong>{filteredCustomers.length}</strong> of <strong>{customers.length}</strong> customers</>
                  : <><strong>{customers.length}</strong> customer{customers.length !== 1 ? 's' : ''}</>
                }
              </span>
              {/* Page size selector */}
              <select
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
                className="text-sm border border-gray-200 rounded px-2 py-1 bg-white text-gray-600"
                style={{ borderRadius: '5px' }}
              >
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
              <button
                onClick={() => setSelectMode(true)}
                title="Select customers"
                className="flex items-center justify-center w-8 h-8 bg-white border border-gray-200 rounded"
                style={{ borderRadius: '5px' }}
              >
                <Pencil className="w-3.5 h-3.5 text-gray-500" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
              >
                <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                <span className="text-sm">Select All</span>
              </button>
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleBulkDelete}
                  disabled={isBusy}
                >
                  {isBusy && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Delete {selectedIds.size}
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={exitSelectMode} title="Cancel">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Customer list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
          </div>
        ) : (
          <div className="grid gap-3">
            {pagedCustomers.map(customer => {
              const fullAddress = buildAddress(customer);
              const isSelected = selectedIds.has(customer.id);
              return (
                <Card key={customer.id} className={isSelected ? 'ring-2 ring-amber-400' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      {selectMode && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(customer.id)}
                          className="shrink-0"
                        />
                      )}
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold">{customer.name || '—'}</h3>
                        {customer.company_name && (
                          <p className="text-sm text-gray-500">{customer.company_name}</p>
                        )}
                        <div className="flex flex-wrap gap-x-4 mt-0.5">
                          {customer.phone && (
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Phone className="w-3 h-3" />{customer.phone}
                            </span>
                          )}
                          {fullAddress && (
                            <span className="text-xs text-gray-400 flex items-center gap-1 truncate">
                              <MapPin className="w-3 h-3 shrink-0" />{fullAddress}
                            </span>
                          )}
                        </div>
                      </div>
                      {!selectMode && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(customer)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(customer)}
                            className="text-red-400 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {filteredCustomers.length === 0 && (
              <div className="text-center py-12">
                <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No customers found</p>
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <p className="text-sm text-gray-500">
              Showing <strong>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredCustomers.length)}</strong> of <strong>{filteredCustomers.length}</strong> customers
              {searchQuery && <span className="text-gray-400"> (filtered)</span>}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >«</Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >‹ Prev</Button>

              {/* Page number buttons — show up to 7 pages around current */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === currentPage ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentPage(p)}
                      className={p === currentPage ? 'bg-amber-600 hover:bg-amber-700' : ''}
                    >{p}</Button>
                  )
                )
              }

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >Next ›</Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >»</Button>
            </div>
          </div>
        )}
      </div>

      <CsvImportModal
        open={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        entityLabel="Customers"
        fields={CUSTOMER_FIELDS}
        onImport={handleCsvImport}
      />

      {/* Add/Edit Customer Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name <span className="text-red-500">*</span></Label>
                <Input value={formData.name} onChange={(e) => set('name', e.target.value)} placeholder="John Doe" required />
              </div>
              <div className="space-y-2">
                <Label>Company Name <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
                <Input value={formData.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="Happy Horse Farm" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Street Address</Label>
                <Input value={formData.street_address} onChange={(e) => set('street_address', e.target.value)} placeholder="123 Farm Road" />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={formData.city} onChange={(e) => set('city', e.target.value)} placeholder="Farmville" />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input value={formData.state} onChange={(e) => set('state', e.target.value)} placeholder="PA" />
              </div>
              <div className="space-y-2">
                <Label>Zip Code</Label>
                <Input value={formData.zip_code} onChange={(e) => set('zip_code', e.target.value)} placeholder="12345" />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input value={formData.country} onChange={(e) => set('country', e.target.value)} placeholder="USA" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Phone</Label>
                <Input value={formData.phone} onChange={(e) => set('phone', e.target.value)} placeholder="555-123-4567" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Map / Location Screenshot <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
                {formData.map_image_url ? (
                  <div className="relative inline-block">
                    <img src={formData.map_image_url} alt="Map screenshot" className="rounded-lg border max-h-40 object-cover" />
                    <button
                      type="button"
                      onClick={() => set('map_image_url', '')}
                      className="absolute top-1 right-1 bg-white rounded-full p-0.5 shadow border hover:bg-red-50"
                    >
                      <X className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg p-4 cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-colors">
                    {uploadingImage ? (
                      <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
                    ) : (
                      <ImagePlus className="w-5 h-5 text-gray-400" />
                    )}
                    <span className="text-xs text-gray-500">{uploadingImage ? 'Uploading...' : 'Click to upload a map screenshot'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
                  </label>
                )}
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Delivery Instructions <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
                <Textarea
                  value={formData.delivery_instructions}
                  onChange={(e) => set('delivery_instructions', e.target.value)}
                  placeholder="e.g. Drive to the shop behind the house, gate code is 1234..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" className="bg-amber-600 hover:bg-amber-700">
                {editingCustomer ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}