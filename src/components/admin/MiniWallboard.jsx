import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus, Package, Truck, MapPin, User, Calendar, Edit, Check, X, UserPlus, Filter, FileText, ArrowUpDown, Trash2, CheckSquare, Move, CalendarDays, Warehouse, Search, StickyNote } from "lucide-react";
import { Input } from "@/components/ui/input";
import CalendarPicker from "@/components/driver/CalendarPicker";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, startOfWeek, addDays, addWeeks, isToday, isSameDay } from "date-fns";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { cn } from "@/lib/utils";
import { base44 } from "@/api/entities";
import { useQueryClient } from "@tanstack/react-query";

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const TRUCK_LABELS = { straight_truck: 'Straight', semi: 'Semi', spreader: 'Spreader' };

// Quick assign dropdown — rendered as a portal to avoid clipping
function AssignPopup({ job, drivers, onAssign, onClose, anchorEl }) {
  const [selectedId, setSelectedId] = useState(job.assigned_driver_id || '');
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX
      });
    }
  }, [anchorEl]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const availableDrivers = drivers.filter((d) => d.active && d.role === 'driver');

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'absolute', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="w-52 bg-white rounded-xl shadow-xl border border-gray-200 p-3"
      onClick={(e) => e.stopPropagation()}>

      <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Assign Driver</p>
      <div className="space-y-1 max-h-48 overflow-y-auto mb-3">
        <button
          onClick={() => setSelectedId('')}
          className={cn(
            "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
            selectedId === '' ? "bg-amber-100 text-amber-800 font-medium" : "hover:bg-gray-100 text-gray-700"
          )}>

          Unassigned
        </button>
        {availableDrivers.map((d) =>
        <button
          key={d.id}
          onClick={() => setSelectedId(d.id)}
          className={cn(
            "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
            selectedId === d.id ? "bg-amber-100 text-amber-800 font-medium" : "hover:bg-gray-100 text-gray-700"
          )}>

            {d.name}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onAssign(selectedId)}
          className="flex-1 flex items-center justify-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg py-2 transition-colors">

          <Check className="w-3.5 h-3.5" /> Confirm
        </button>
        <button
          onClick={onClose}
          className="flex-1 flex items-center justify-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg py-2 transition-colors">

          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}

function JobDetailPopup({ job, driver, onClose, onEdit, onDelete, pickupLocations = [] }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Per-load pickup details (all delivery truck types)
  const hasPerLoadData = job.job_type === 'delivery' && Array.isArray(job.loads) && job.loads.length > 0;
  const perLoadDetails = hasPerLoadData ?
  job.loads.filter((l) => l.pickup_location_name || l.yards_collected) :
  [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {job.job_type === 'pickup' ?
            <Package className="w-5 h-5 text-amber-600" /> :
            <Truck className="w-5 h-5 text-blue-600" />
            }
            {job.job_type === 'pickup' ? 'Pickup Job' : 'Delivery Job'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <Badge className={cn(
              job.status === 'completed' && "bg-green-100 text-green-700",
              job.status === 'pending' && "bg-red-100 text-red-700",
              job.status === 'in_progress' && "bg-yellow-100 text-yellow-700",
              job.status === 'cancelled' && "bg-gray-100 text-gray-600"
            )}>
              {job.status}
            </Badge>
            {job.truck_type &&
            <span className="text-xs text-gray-500">{TRUCK_LABELS[job.truck_type] || job.truck_type}</span>
            }
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">{job.job_type === 'pickup' ? 'Pickup Location' : 'Location'}</p>
                <p className="font-semibold text-gray-900">{job.location_name}</p>
                <p className="text-gray-500 text-xs">{job.address}</p>
              </div>
            </div>
            {job.job_type === 'pickup' && job.dropoff_location_name && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-400">Drop-Off Location</p>
                  <p className="font-semibold text-gray-900">{job.dropoff_location_name}</p>
                </div>
              </div>
            )}
            {job.pickup_location_id && (() => {
              const loc = pickupLocations.find(l => l.id === job.pickup_location_id);
              return loc ? (
                <div className="flex items-start gap-2">
                  <Warehouse className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400">Pickup Location</p>
                    <p className="font-semibold text-gray-900">{loc.name}</p>
                  </div>
                </div>
              ) : null;
            })()}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-gray-700">{format(new Date(job.scheduled_date + 'T00:00:00'), 'EEEE, MMM d')}</span>
            </div>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-gray-400" />
              <span className="text-gray-700">{driver?.name || 'Unassigned'}</span>
            </div>
            <div className="text-gray-700">
              <span className="font-medium">{job.quantity} load{job.quantity !== 1 ? 's' : ''}</span>
              {job.load_configuration && <span className="text-gray-500 ml-1">— {job.load_configuration}</span>}
            </div>
            {job.dispatcher_notes &&
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                <p className="text-xs text-amber-800 font-medium mb-1">Notes</p>
                <p className="text-sm text-amber-900">{job.dispatcher_notes}</p>
              </div>
            }
            {/* Josh per-load pickup details */}
            {perLoadDetails.length > 0 &&
            <div className="border border-blue-100 rounded-lg overflow-hidden">
                <div className="bg-blue-50 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Load Pickup Details</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-blue-100">
                      <th className="text-left px-3 py-1.5 text-gray-500 font-medium">Load</th>
                      <th className="text-left px-3 py-1.5 text-gray-500 font-medium">Pickup Location</th>
                      <th className="text-right px-3 py-1.5 text-gray-500 font-medium">Yards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perLoadDetails.map((l, idx) =>
                  <tr key={l.load_number} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2 font-medium text-gray-700">Load {l.load_number}</td>
                        <td className="px-3 py-2 text-gray-700">{l.pickup_location_name || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-700">{l.yards_collected ? `${l.yards_collected} yds` : '—'}</td>
                      </tr>
                  )}
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
        <div className="flex justify-between items-center pt-2">
          <Button variant="outline" onClick={() => setShowDeleteConfirm(true)} className="text-red-600 border-red-300 hover:bg-red-50">
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button onClick={() => {onClose();onEdit(job);}} className="bg-amber-600 hover:bg-amber-700">
              <Edit className="w-4 h-4 mr-2" />
              Edit Job
            </Button>
          </div>
        </div>
      </DialogContent>
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
    </Dialog>);

}

// Individual job card in the weekly grid
function MiniJobCard({ job, drivers, pickupLocations = [], isAdmin, onEditJob, onAssigned, editMode = false, isSelected = false, onToggleSelect }) {
  const [showAssign, setShowAssign] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const queryClient = useQueryClient();

  const driver = drivers.find((d) => d.id === job.assigned_driver_id) || null;

  const hasNotes = !!((job.dispatcher_notes && job.dispatcher_notes.trim()) || (job.driver_notes && job.driver_notes.trim()));

  const handleAssign = async (driverId) => {
    const newDriver = drivers.find((d) => d.id === driverId) || null;
    await base44.entities.Job.update(job.id, {
      assigned_driver_id: driverId || null,
      assigned_driver_name: newDriver?.name || null,
      assigned_driver_pickup_role: newDriver?.pickup_role || 'none'
    });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    setShowAssign(false);
    if (onAssigned) onAssigned();
  };

  const handleDelete = async () => {
    await base44.entities.Job.delete(job.id);
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    setShowDetail(false);
  };

  const handleInvoice = async (value) => {
    // Clicking the currently-selected button is a no-op — every delivery job
    // must always be either 'yes' or 'no', never null.
    if (job.invoice_sent === value) return;
    const markerName =
      localStorage.getItem('miller_driver_name') ||
      localStorage.getItem('miller_driver_role') ||
      'Staff';
    await base44.entities.Job.update(job.id, {
      invoice_sent: value,
      invoice_marked_by: markerName,
      invoice_marked_at: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['jobs', 'invoicing'] });
  };

  return (
    <>
      <div className="relative">
        {/* Card */}
        <div
          onClick={() => {
            if (editMode) { onToggleSelect && onToggleSelect(job.id); }
            else if (isAdmin) setShowDetail(true);
          }}
          className={cn(
            "rounded p-2 text-[10px] leading-tight border transition-all",
            job.status === 'completed' ?
            "bg-green-50 border-green-200 text-green-800" :
            job.status === 'in_progress' ?
            "bg-yellow-50 border-yellow-200 text-yellow-900" :
            "bg-gray-50 border-gray-200 text-gray-800",
            isAdmin && "cursor-pointer hover:shadow-md transition-shadow",
            editMode && isSelected && "ring-2 ring-blue-500 ring-offset-1"
          )}>

          {/* Edit mode checkbox */}
          {editMode && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className={cn(
                "w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0",
                isSelected ? "bg-blue-500 border-blue-500" : "border-gray-400 bg-white"
              )}>
                {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <span className="text-[9px] text-gray-500 font-medium">Select</span>
            </div>
          )}

          {/* Type row */}
          <div className="flex items-center gap-1 mb-1">
            {job.job_type === 'pickup' ?
            <Package className="w-2.5 h-2.5 text-amber-600 shrink-0" /> :
            <Truck className="w-2.5 h-2.5 text-blue-600 shrink-0" />
            }
            <span className={cn(
              "font-bold uppercase text-[9px]",
              job.job_type === 'pickup' ? "text-amber-700" : "text-blue-700"
            )}>
              {job.job_type}
            </span>
            {job.truck_type &&
            <span className="text-gray-400 text-[9px] ml-auto">{TRUCK_LABELS[job.truck_type]}</span>
            }
          </div>

          {/* 2-col layout: left = location+driver, right = loads+config */}
          <div className="flex items-start gap-1 mt-0.5">
            {/* Left: location + driver */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate text-[11px]" title={job.location_name}>
                {job.location_name}
              </p>
              {job.customer_company_name && (
                <p className="text-[9px] text-gray-400 truncate -mt-0.5" title={job.customer_company_name}>
                  {job.customer_company_name}
                </p>
              )}
              <p className={cn("truncate mt-0.5", driver ? "text-gray-600" : "italic text-gray-400")}>
                {driver?.name || 'Unassigned'}
              </p>
            </div>
            {/* Right: loads + config */}
            <div className="shrink-0 flex flex-col items-end text-right">
              <span className="text-[10px] text-gray-600 leading-tight">{job.quantity} load{job.quantity !== 1 ? 's' : ''}</span>
              {(() => {
                let label = null;
                if (Array.isArray(job.loads) && job.loads.length > 0) {
                  const configs = job.loads.filter(l => l.load_configuration).map(l => l.load_configuration);
                  if (configs.length > 0) label = configs.join(' / ');
                } else if (job.load_configuration) {
                  label = job.load_configuration;
                }
                return label ? (
                  <span className="text-[9px] text-gray-500 leading-tight" title={label}>{label}</span>
                ) : null;
              })()}
            </div>
          </div>



          {/* Notes pill + Invoice toggle row */}
          {isAdmin && !editMode && (hasNotes || job.job_type === 'delivery') &&
          <div
            className="mt-1.5 flex items-center justify-between border-t pt-1.5"
            onClick={(e) => e.stopPropagation()}>

              {/* Left: Notes pill (or empty) */}
              <div className="flex items-center">
                {hasNotes && (
                  <span className="inline-flex items-center gap-0.5 bg-black text-white text-[9px] px-1.5 py-0.5 rounded font-semibold">
                    <StickyNote className="w-2.5 h-2.5" />
                    NOTE
                  </span>
                )}
              </div>

              {/* Right: Invoice + Yes/No buttons (delivery only) */}
              {job.job_type === 'delivery' && (
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-gray-500 flex items-center gap-0.5">
                    <FileText className="w-2.5 h-2.5" />
                    Invoice
                  </span>
                  <button
                    onClick={() => handleInvoice('yes')}
                    className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors",
                      job.invoice_sent === 'yes' ?
                      "bg-green-500 text-white" :
                      "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}>
                    Yes
                  </button>
                  <button
                    onClick={() => handleInvoice('no')}
                    className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors",
                      job.invoice_sent === 'no' ?
                      "bg-red-400 text-white" :
                      "bg-white text-gray-500 hover:bg-gray-100 border border-gray-200"
                    )}>
                    No
                  </button>
                </div>
              )}
            </div>
          }

          {/* Assign button */}
          {isAdmin && !editMode && job.status !== 'cancelled' && job.status !== 'completed' &&
          <button
            onClick={(e) => {e.stopPropagation();setAnchorEl(e.currentTarget);setShowAssign((v) => !v);}}
            className={cn(
              "mt-1.5 w-full flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold transition-colors",
              driver ?
              "bg-gray-100 hover:bg-gray-200 text-gray-600" :
              "bg-amber-100 hover:bg-amber-200 text-amber-800"
            )}>

              <UserPlus className="w-2.5 h-2.5" />
              {driver ? 'Reassign' : 'Assign'}
            </button>
          }
        </div>

        {/* Assign popup — rendered via portal */}
        {showAssign &&
        <AssignPopup
          job={job}
          drivers={drivers}
          onAssign={handleAssign}
          onClose={() => setShowAssign(false)}
          anchorEl={anchorEl} />

        }
      </div>

      {/* Detail popup */}
      {showDetail && isAdmin &&
      <JobDetailPopup
        job={job}
        driver={driver}
        pickupLocations={pickupLocations}
        onClose={() => setShowDetail(false)}
        onEdit={(j) => {setShowDetail(false);onEditJob(j);}}
        onDelete={handleDelete} />

      }
    </>);

}

export default function MiniWallboard({ jobs, drivers, pickupLocations = [], onAddJob, onEditJob, onSortJobs, isAdmin }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterDriver, setFilterDriver] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [mobileSelectedDate, setMobileSelectedDate] = useState(new Date());
  const [selectedJobIds, setSelectedJobIds] = useState(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(null); // null | { current, total, done }
  const [showMovePopover, setShowMovePopover] = useState(false);
  const [moveToDate, setMoveToDate] = useState('');
  const [dragOverDay, setDragOverDay] = useState(null);
  const queryClient = useQueryClient();

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekDays = DAYS.map((_, i) => addDays(weekStart, i));

  const getJobsForDay = (day) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    return jobs
      .filter((j) => {
        if (j.scheduled_date !== dateStr) return false;
        if (j.status === 'cancelled') return false;
        if (filterDriver !== 'all' && j.assigned_driver_id !== filterDriver) return false;
        if (filterType !== 'all' && j.truck_type !== filterType) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const match = (j.location_name || '').toLowerCase().includes(q)
            || (j.assigned_driver_name || '').toLowerCase().includes(q)
            || (j.address || '').toLowerCase().includes(q)
            || (j.load_configuration || '').toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
        if (a.sort_order != null) return -1;
        if (b.sort_order != null) return 1;
        return 0;
      });
  };

  const toggleEditMode = () => {
    setEditMode((v) => !v);
    setSelectedJobIds(new Set());
    setShowMovePopover(false);
  };

  const toggleSelectJob = (id) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const idsToDelete = [...selectedJobIds];
    const total = idsToDelete.length;

    setDeleteProgress({ current: 0, total, done: false });

    for (let i = 0; i < idsToDelete.length; i++) {
      setDeleteProgress({ current: i + 1, total, done: false });
      await base44.entities.Job.delete(idsToDelete[i]);
    }

    setDeleteProgress({ current: total, total, done: true });

    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['jobs'] }),
      queryClient.refetchQueries({ queryKey: ['wallboard-jobs'] }),
    ]);

    setTimeout(() => {
      setDeleteProgress(null);
      setShowBulkDelete(false);
      setSelectedJobIds(new Set());
      setEditMode(false);
    }, 1500);
  };

  const handleBulkMove = async () => {
    if (!moveToDate) return;
    await Promise.all([...selectedJobIds].map((id) => base44.entities.Job.update(id, { scheduled_date: moveToDate })));
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    setSelectedJobIds(new Set());
    setShowMovePopover(false);
    setMoveToDate('');
    setEditMode(false);
  };

  const handleDragEnd = async (result) => {
    setDragOverDay(null);
    if (!result.destination) return;

    const fromDate = result.source.droppableId;
    const toDate = result.destination.droppableId;
    const fromIndex = result.source.index;
    const toIndex = result.destination.index;
    const jobId = result.draggableId;

    if (fromDate === toDate && fromIndex === toIndex) return;

    // Get the currently displayed (sorted+filtered) jobs for a given date
    const getSortedForDate = (dateStr) =>
      jobs
        .filter(j => {
          if (j.scheduled_date !== dateStr || j.status === 'cancelled') return false;
          if (filterDriver !== 'all' && j.assigned_driver_id !== filterDriver) return false;
          if (filterType !== 'all' && j.truck_type !== filterType) return false;
          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            const match = (j.location_name || '').toLowerCase().includes(q)
              || (j.assigned_driver_name || '').toLowerCase().includes(q)
              || (j.address || '').toLowerCase().includes(q)
              || (j.load_configuration || '').toLowerCase().includes(q);
            if (!match) return false;
          }
          return true;
        })
          .sort((a, b) => {
          if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
          if (a.sort_order != null) return -1;
          if (b.sort_order != null) return 1;
          return 0;
        });

    const fromJobs = getSortedForDate(fromDate);
    const toJobs = fromDate === toDate ? fromJobs : getSortedForDate(toDate);
    const movedJob = fromJobs.find(j => j.id === jobId);
    if (!movedJob) return;

    const updates = []; // { id, sort_order, scheduled_date? }

    if (fromDate === toDate) {
      // Same-day reorder
      const reordered = [...fromJobs];
      reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, movedJob);
      reordered.forEach((j, idx) => updates.push({ id: j.id, sort_order: idx }));
    } else {
      // Cross-day move: reindex source day without the moved job
      const newFrom = fromJobs.filter(j => j.id !== jobId);
      newFrom.forEach((j, idx) => updates.push({ id: j.id, sort_order: idx }));

      // Insert into destination day at drop index and reindex
      const newTo = [...toJobs];
      newTo.splice(toIndex, 0, movedJob);
      newTo.forEach((j, idx) => updates.push({
        id: j.id,
        sort_order: idx,
        ...(j.id === jobId ? { scheduled_date: toDate } : {}),
      }));
    }

    // Optimistic update
    queryClient.setQueryData(['jobs'], (oldJobs) => {
      const map = new Map(updates.map(u => [u.id, u]));
      return (oldJobs ?? []).map(j => {
        const u = map.get(j.id);
        return u ? { ...j, ...u } : j;
      });
    });

    // Persist all sort_order + date changes
    await Promise.all(updates.map(u => {
      const payload = { sort_order: u.sort_order };
      if (u.scheduled_date) payload.scheduled_date = u.scheduled_date;
      return base44.entities.Job.update(u.id, payload);
    }));

    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };

  const weekLabel = () => {
    if (weekOffset === 0) return 'This Week';
    if (weekOffset === 1) return 'Next Week';
    return `${format(weekStart, 'MMM d')}–${format(addDays(weekStart, 4), 'MMM d')}`;
  };

  const activeDrivers = drivers.filter((d) => d.active && d.role === 'driver');

  return (
    <div className="bg-white rounded-xl border flex flex-col flex-1 lg:min-h-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 border-b gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-800 text-sm">Weekly View</h2>
          {/* Mobile calendar button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 lg:hidden"
            onClick={() => setShowCalendar(true)}
          >
            <CalendarDays className="w-4 h-4 text-amber-600" />
          </Button>
          <span className="text-sm text-gray-500 font-medium">{weekLabel()}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekOffset((w) => w - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          {weekOffset !== 0 &&
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setWeekOffset(0)}>
              Today
            </Button>
          }
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!editMode ? (
            <>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 text-xs pl-7 w-44"
                />
              </div>
              <Filter className="w-3.5 h-3.5 text-gray-400" />
              <Select value={filterDriver} onValueChange={setFilterDriver}>
                <SelectTrigger className="h-7 text-xs w-36">
                  <SelectValue placeholder="All Drivers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Drivers</SelectItem>
                  {activeDrivers.map((d) =>
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-7 text-xs w-36">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="straight_truck">Straight Truck</SelectItem>
                  <SelectItem value="semi">Semi</SelectItem>
                  <SelectItem value="spreader">Spreader</SelectItem>
                </SelectContent>
              </Select>
              {isAdmin && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={toggleEditMode}>
                  <CheckSquare className="w-3.5 h-3.5 mr-1" />
                  Edit
                </Button>
              )}
            </>
          ) : (
            <>
              <span className="text-xs text-blue-600 font-medium">
                {selectedJobIds.size} selected
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-red-600 border-red-300 hover:bg-red-50"
                disabled={selectedJobIds.size === 0}
                onClick={() => setShowBulkDelete(true)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Delete
              </Button>
              <Popover open={showMovePopover} onOpenChange={setShowMovePopover}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-blue-600 border-blue-300 hover:bg-blue-50"
                    disabled={selectedJobIds.size === 0}
                  >
                    <Move className="w-3.5 h-3.5 mr-1" />
                    Move
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-4" align="end">
                  <p className="font-semibold text-sm text-gray-800 mb-3">Move {selectedJobIds.size} job{selectedJobIds.size !== 1 ? 's' : ''} to new date</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">New Date</label>
                      <input
                        type="date"
                        value={moveToDate}
                        onChange={(e) => setMoveToDate(e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => { setShowMovePopover(false); setMoveToDate(''); }}>
                        Cancel
                      </Button>
                      <Button size="sm" className="flex-1 text-xs bg-blue-600 hover:bg-blue-700" disabled={!moveToDate} onClick={handleBulkMove}>
                        Confirm Move
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleEditMode}>
                <X className="w-3.5 h-3.5 mr-1" />
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Mobile single-day view */}
      {mobileSelectedDate && (
        <div className="lg:hidden">
          {/* Date banner */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 border-b border-amber-200">
            <span className="text-sm font-semibold text-amber-800">
              📅 {format(mobileSelectedDate, 'EEEE, MMMM d')}
            </span>
            <button
              onClick={() => setMobileSelectedDate(null)}
              className="flex items-center gap-1 text-xs text-amber-600 font-medium"
            >
              <X className="w-3.5 h-3.5" />
              Back to week
            </button>
          </div>
          {/* Jobs for selected day */}
          <div className="p-3 space-y-2">
            {(() => {
              const dateStr = format(mobileSelectedDate, 'yyyy-MM-dd');
              const dayJobs = jobs
                .filter(j => {
                  if (j.scheduled_date !== dateStr || j.status === 'cancelled') return false;
                  if (filterDriver !== 'all' && j.assigned_driver_id !== filterDriver) return false;
                  if (filterType !== 'all' && j.truck_type !== filterType) return false;
                  if (searchQuery.trim()) {
                    const q = searchQuery.toLowerCase().trim();
                    const match = (j.location_name || '').toLowerCase().includes(q)
                      || (j.assigned_driver_name || '').toLowerCase().includes(q)
                      || (j.address || '').toLowerCase().includes(q)
                      || (j.load_configuration || '').toLowerCase().includes(q);
                    if (!match) return false;
                  }
                  return true;
                })
                  .sort((a, b) => {
                  if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
                  if (a.sort_order != null) return -1;
                  if (b.sort_order != null) return 1;
                  return 0;
                });
              if (dayJobs.length === 0) return (
                <p className="text-sm text-gray-400 text-center py-8">No jobs scheduled for this day</p>
              );
              return dayJobs.map(job => (
                <MiniJobCard
                  key={job.id}
                  job={job}
                  drivers={drivers}
                  pickupLocations={pickupLocations}
                  isAdmin={isAdmin}
                  onEditJob={onEditJob}
                  editMode={false}
                  isSelected={false}
                />
              ));
            })()}
          </div>
          {isAdmin && (
            <div className="px-3 pb-3">
              <button
                onClick={() => onAddJob(format(mobileSelectedDate, 'yyyy-MM-dd'))}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add job on {format(mobileSelectedDate, 'MMM d')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mobile prompt when no date selected */}
      {!mobileSelectedDate && (
        <div className="lg:hidden flex flex-col items-center justify-center py-10 gap-3 text-gray-500">
          <CalendarDays className="w-10 h-10 text-amber-400" />
          <p className="text-sm font-medium">Tap the calendar icon to pick a day</p>
          <Button variant="outline" size="sm" onClick={() => setShowCalendar(true)} className="text-amber-700 border-amber-300">
            Open Calendar
          </Button>
        </div>
      )}

      {/* Day Columns — hidden on mobile always, shown on desktop */}
      <div className={mobileSelectedDate ? 'hidden lg:flex lg:flex-col lg:flex-1 lg:min-h-0' : 'hidden lg:flex lg:flex-col lg:flex-1 lg:min-h-0'}>
      {/* Day Columns */}
      <DragDropContext
        onDragEnd={handleDragEnd}
        onDragUpdate={(update) => {
          setDragOverDay(update.destination?.droppableId || null);
        }}
        onDragStart={() => setDragOverDay(null)}
      >
        <div className="grid grid-cols-5 divide-x flex-1 min-h-0">
          {weekDays.map((day, i) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayJobs = getJobsForDay(day);
            const isCurrentDay = isToday(day);
            const isDragTarget = dragOverDay === dateStr;
            return (
              <div key={i} className="min-w-0 flex flex-col min-h-0">
                {/* Day Header */}
                <div className={cn(
                  "flex items-center justify-between px-2 py-2 border-b shrink-0",
                  isCurrentDay ? "bg-amber-50" : "bg-gray-50"
                )}>
                  <div>
                    <p className="text-amber-700 text-base font-semibold">
                      {DAYS[i]}
                    </p>
                    <p className={cn("text-sm font-bold", isCurrentDay ? "text-amber-800" : "text-gray-800")}>
                      {format(day, 'd')}
                    </p>
                  </div>
                  {isAdmin && !editMode &&
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onSortJobs(dateStr)}
                      className="w-6 h-6 rounded-full bg-white border border-gray-300 hover:bg-gray-50 text-black flex items-center justify-center transition-colors"
                      title={`Sort jobs on ${format(day, 'MMM d')}`}>
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    <button
                      onClick={() => onAddJob(dateStr)}
                      className="w-6 h-6 rounded-full bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center transition-colors"
                      title={`Add job on ${format(day, 'MMM d')}`}>
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                  </div>
                  }
                </div>

                {/* Jobs — droppable zone */}
                <Droppable droppableId={dateStr} isDropDisabled={!isAdmin || editMode}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        "p-1.5 space-y-1.5 overflow-y-auto transition-colors duration-150 flex-1",
                        snapshot.isDraggingOver
                          ? "bg-blue-50 ring-2 ring-inset ring-blue-300"
                          : isDragTarget
                          ? "bg-blue-50/50"
                          : ""
                      )}
                    >
                      {dayJobs.length === 0 && !snapshot.isDraggingOver ?
                        <p className="text-xs text-gray-300 text-center pt-6">—</p> :
                        dayJobs.map((job, index) =>
                          <Draggable
                            key={job.id}
                            draggableId={job.id}
                            index={index}
                            isDragDisabled={!isAdmin || editMode}
                          >
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                className={cn(
                                  "transition-shadow",
                                  dragSnapshot.isDragging && "opacity-90 shadow-lg rotate-1 scale-105 z-50"
                                )}
                              >
                                <MiniJobCard
                                  job={job}
                                  drivers={drivers}
                                  pickupLocations={pickupLocations}
                                  isAdmin={isAdmin}
                                  onEditJob={onEditJob}
                                  editMode={editMode}
                                  isSelected={selectedJobIds.has(job.id)}
                                  onToggleSelect={toggleSelectJob}
                                  isDragging={dragSnapshot.isDragging}
                                />
                              </div>
                            )}
                          </Draggable>
                        )
                      }
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
      </div>{/* end desktop columns wrapper */}
      <AlertDialog open={showBulkDelete} onOpenChange={(open) => { if (!deleteProgress) setShowBulkDelete(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteProgress
                ? deleteProgress.done
                  ? '✅ Delete Complete'
                  : `Deleting jobs...`
                : `Delete ${selectedJobIds.size} job${selectedJobIds.size !== 1 ? 's' : ''}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteProgress ? (
                <div className="space-y-3 mt-2">
                  <p className="text-sm text-gray-700">
                    {deleteProgress.done
                      ? `All ${deleteProgress.total} job${deleteProgress.total !== 1 ? 's' : ''} deleted successfully.`
                      : `Deleting ${deleteProgress.current} of ${deleteProgress.total}...`}
                  </p>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className={cn(
                        "h-2.5 rounded-full transition-all duration-300",
                        deleteProgress.done ? "bg-green-500" : "bg-red-500"
                      )}
                      style={{ width: `${(deleteProgress.current / deleteProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              ) : (
                'This action cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!deleteProgress && (
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700">Confirm Delete</AlertDialogAction>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
      {showCalendar && (
        <CalendarPicker
          jobs={jobs}
          onSelectDate={(date) => {
            setMobileSelectedDate(date);
            setShowCalendar(false);
          }}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </div>);

}