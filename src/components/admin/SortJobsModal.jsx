import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { GripVertical, Truck, Package, Loader2, Route } from "lucide-react";
import { format, addDays } from "date-fns";
import { base44 } from "@/api/entities";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import StopsMap from "@/components/admin/StopsMap";

function JobCardContent({ job, index, isGhost }) {
  return (
    <>
      <div className={cn("p-1.5 rounded shrink-0", job.job_type === 'pickup' ? "bg-amber-100" : "bg-blue-100")}>
        {job.job_type === 'pickup'
          ? <Package className="w-4 h-4 text-amber-700" />
          : <Truck className="w-4 h-4 text-blue-700" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-gray-900 truncate">{job.location_name}</p>
        <p className="text-xs text-gray-500">{job.quantity} load{job.quantity !== 1 ? 's' : ''}</p>
      </div>
      <span className={cn("text-xs font-medium shrink-0", isGhost ? "text-amber-600" : "text-gray-400")}>
        #{index + 1}
      </span>
    </>
  );
}

export default function SortJobsModal({ open, onClose, jobs, drivers, preSelectedDate = null, customers = [], pickupLocations = [], dropOffLocations = [] }) {
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedDate, setSelectedDate] = useState(preSelectedDate || format(new Date(), 'yyyy-MM-dd'));
  const [orderedJobs, setOrderedJobs] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [driverDropdownOpen, setDriverDropdownOpen] = useState(false);
  // Route check (admin/dispatcher only — the edge function enforces it too)
  const [routeCheck, setRouteCheck] = useState(null);
  const canCheckRoute = ['admin', 'dispatcher'].includes(
    typeof window !== 'undefined' ? window.localStorage.getItem('miller_driver_role') : ''
  );

  // drag state: null or { index, offsetY, currentY, cardHeight }
  const [dragState, setDragState] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  const listRef = useRef(null);
  const dragRef = useRef(null); // mirrors dragState for access inside event handlers
  const queryClient = useQueryClient();

  const dateOptions = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(new Date(), i - 3);
    return { value: format(d, 'yyyy-MM-dd'), label: format(d, 'EEE, MMM d') };
  });

  const activeDrivers = drivers.filter(d => d.active && d.role === 'driver');

  // Update selectedDate when preSelectedDate changes (when modal opens)
  // Auto-open driver dropdown when modal opens
  useEffect(() => {
    if (open && preSelectedDate) {
      setSelectedDate(preSelectedDate);
      setDriverDropdownOpen(true);
    }
  }, [open, preSelectedDate]);

  useEffect(() => {
    if (!selectedDriverId || !selectedDate) { setOrderedJobs([]); return; }
    const filtered = jobs
      .filter(j =>
        j.assigned_driver_id === selectedDriverId &&
        j.scheduled_date === selectedDate &&
        j.status !== 'cancelled'
      )
      .sort((a, b) => {
        if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
        if (a.sort_order != null) return -1;
        if (b.sort_order != null) return 1;
        return 0;
      });
    setOrderedJobs(filtered);
    setRouteCheck(null);
  }, [selectedDriverId, selectedDate, jobs]);

  const handleCheckRoute = async () => {
    setRouteCheck({ status: 'loading' });
    try {
      const { data } = await base44.functions.invoke('optimize-route', {
        driver_id: selectedDriverId,
        date: selectedDate,
      });
      setRouteCheck({ status: 'done', data });
    } catch {
      setRouteCheck({ status: 'error' });
    }
  };

  // Map pins: each job's end point (customer / drop-off) in the list's order.
  // Same aliasing as the optimizer: unpinned home-property records = home.
  const homeBase = pickupLocations.find(p => p.location_type === 'my_building' && /home hoop/i.test(p.name || ''));
  const home = homeBase?.latitude != null ? { lat: homeBase.latitude, lng: homeBase.longitude } : null;
  const custById = new Map(customers.map(c => [c.id, c]));
  const dropById = new Map(dropOffLocations.map(d => [d.id, d]));
  const mapStops = [];
  let unmappedCount = 0;
  for (const j of orderedJobs) {
    const label = (j.customer_company_name || j.location_name || '').trim();
    let rec = j.job_type === 'pickup' ? dropById.get(j.dropoff_location_id) : custById.get(j.customer_id);
    if (rec && /hoop building 257|own sawdust/i.test(rec.name || '') && home) {
      mapStops.push({ label, ...home });
    } else if (rec?.latitude != null) {
      mapStops.push({ label, lat: rec.latitude, lng: rec.longitude });
    } else {
      unmappedCount++;
    }
  }

  const handleUseSuggestedOrder = () => {
    const suggested = routeCheck?.data?.suggested?.order;
    if (!suggested) return;
    setOrderedJobs(prev => {
      const byId = new Map(prev.map(j => [j.id, j]));
      const reordered = suggested.map(s => byId.get(s.job_id)).filter(Boolean);
      // Jobs the check couldn't place (unpinned addresses) keep their spot at the end
      const placed = new Set(reordered.map(j => j.id));
      return [...reordered, ...prev.filter(j => !placed.has(j.id))];
    });
    setRouteCheck(rc => ({ ...rc, applied: true }));
  };

  const handleMouseDown = useCallback((e, fromIndex) => {
    e.preventDefault();
    const listEl = listRef.current;
    if (!listEl) return;

    const items = listEl.querySelectorAll('[data-item]');
    const itemRect = items[fromIndex].getBoundingClientRect();
    const listRect = listEl.getBoundingClientRect();

    const offsetY = e.clientY - itemRect.top;
    const currentY = e.clientY - listRect.top;
    const cardHeight = itemRect.height;

    const initial = { index: fromIndex, offsetY, currentY, cardHeight, dropIndex: fromIndex };
    dragRef.current = initial;
    setDragState({ index: fromIndex, offsetY, currentY, cardHeight });
    setDropIndex(fromIndex);

    const handleMouseMove = (moveEvent) => {
      const listEl = listRef.current;
      if (!listEl) return;
      const listRect = listEl.getBoundingClientRect();
      const newCurrentY = moveEvent.clientY - listRect.top;

      dragRef.current = { ...dragRef.current, currentY: newCurrentY };
      setDragState(prev => prev ? { ...prev, currentY: newCurrentY } : null);

      // Compute drop index from live item positions
      const items = listEl.querySelectorAll('[data-item]');
      let newDrop = items.length;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (moveEvent.clientY < rect.top + rect.height / 2) {
          newDrop = i;
          break;
        }
      }
      dragRef.current.dropIndex = newDrop;
      setDropIndex(newDrop);
    };

    const handleMouseUp = () => {
      const { dropIndex: to, index: from } = dragRef.current;
      if (to !== null && to !== from && to !== from + 1) {
        setOrderedJobs(prev => {
          const arr = [...prev];
          const [moved] = arr.splice(from, 1);
          const insertAt = to > from ? to - 1 : to;
          arr.splice(insertAt, 0, moved);
          return arr;
        });
      }
      setDragState(null);
      setDropIndex(null);
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    await Promise.all(
      orderedJobs.map((job, idx) => base44.entities.Job.update(job.id, { sort_order: idx }))
    );
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    setIsSaving(false);
    onClose();
  };

  // Ghost card position: clamped within the list container
  const ghostTop = dragState
    ? Math.max(0, dragState.currentY - dragState.offsetY)
    : 0;

  // Compute preview order: show how the list will look after drop
  const getPreviewOrder = () => {
    if (!dragState || dropIndex === null) return orderedJobs;
    const { index: dragIdx } = dragState;
    if (dropIndex === dragIdx || dropIndex === dragIdx + 1) return orderedJobs;

    const preview = [...orderedJobs];
    const [dragged] = preview.splice(dragIdx, 1);
    const insertAt = dropIndex > dragIdx ? dropIndex - 1 : dropIndex;
    preview.splice(insertAt, 0, dragged);
    return preview;
  };

  const previewOrder = getPreviewOrder();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GripVertical className="w-5 h-5 text-amber-600" />
            Sort Driver Jobs
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row gap-5 items-stretch">
        <div className="flex-1 min-w-0 space-y-3">
          {/* Driver selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Select Driver</label>
            <Select value={selectedDriverId} onValueChange={setSelectedDriverId} open={driverDropdownOpen} onOpenChange={setDriverDropdownOpen}>
              <SelectTrigger>
                <SelectValue placeholder="Select driver..." />
              </SelectTrigger>
              <SelectContent>
                {activeDrivers.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Job list */}
          {!selectedDriverId ? (
            <p className="text-sm text-gray-400 text-center py-8">Select a driver to sort their jobs</p>
          ) : orderedJobs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              No jobs for {activeDrivers.find(d => d.id === selectedDriverId)?.name || 'this driver'} on {format(new Date(selectedDate), 'MMMM d')}
            </p>
          ) : (
            <div
              ref={listRef}
              className="relative select-none overflow-hidden"
              style={{
                cursor: dragState ? 'grabbing' : 'default',
                // ensure container is tall enough to contain the ghost
                minHeight: orderedJobs.length * 60,
              }}
            >
              {/* Drop indicator at top */}
              <div className={cn(
                "h-1 rounded-full mx-2 mb-1 transition-colors duration-100",
                dragState && dropIndex === 0 ? "bg-amber-400" : "bg-transparent"
              )} />

              {previewOrder.map((job, index) => {
                const originalIdx = dragState ? orderedJobs.findIndex(j => j.id === job.id) : index;
                const isDragged = dragState?.index === originalIdx;
                return (
                  <motion.div
                    key={job.id}
                    layout
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                  <div
                    data-item
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border mb-1 transition-all duration-150",
                      isDragged
                        ? "opacity-0 border-dashed border-amber-300 bg-amber-50"
                        : "bg-white border-gray-200 hover:border-gray-300"
                    )}
                  >
                    <div
                      className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0"
                      onMouseDown={(e) => handleMouseDown(e, originalIdx)}
                    >
                      <GripVertical className="w-5 h-5" />
                    </div>
                    <JobCardContent job={job} index={index} isGhost={false} />
                  </div>

                    {/* Drop indicator below each item */}
                    <div className={cn(
                      "h-1 rounded-full mx-2 mb-1 transition-colors duration-100",
                      dragState && dropIndex === index + 1 ? "bg-amber-400" : "bg-transparent"
                    )} />
                  </motion.div>
                );
              })}

              {/* Floating ghost card — stays inside container via overflow:hidden */}
              {dragState && orderedJobs[dragState.index] && (
                <div
                  className="absolute left-0 right-0 flex items-center gap-3 p-3 rounded-lg border border-amber-400 bg-white shadow-xl pointer-events-none z-50"
                  style={{
                    top: ghostTop,
                    transform: 'rotate(1.5deg) scale(1.03)',
                    opacity: 0.95,
                  }}
                >
                  <JobCardContent job={orderedJobs[dragState.index]} index={dragState.index} isGhost={true} />
                </div>
              )}
            </div>
          )}

          {/* Route check result */}
          {routeCheck?.status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              Checking this route against real road times...
            </div>
          )}
          {routeCheck?.status === 'error' && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              The route check couldn't run. Try again in a moment.
            </div>
          )}
          {routeCheck?.status === 'done' && (() => {
            const d = routeCheck.data;
            if (!d?.enough) {
              return (
                <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                  Not enough mapped jobs on this day to compare orders.
                </div>
              );
            }
            const savedMin = Math.round(d.savings_seconds / 60);
            const savedMi = (d.savings_meters / 1609.34).toFixed(1);
            const unpinnedNote = d.unpinned?.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                Not included (address not verified yet): {d.unpinned.join(', ')}
              </p>
            );
            if (d.savings_seconds < 300) {
              return (
                <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">
                  <span className="font-semibold">This order is already good</span> — the best
                  order found would save less than 5 minutes.
                  {unpinnedNote}
                </div>
              );
            }
            return (
              <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="font-semibold text-amber-900">
                  A better order could save about {savedMin} min · {savedMi} mi
                </p>
                <ol className="mt-2 space-y-1 text-amber-900">
                  {d.suggested.order.map((s, i) => (
                    <li key={s.job_id} className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      <span className="truncate">{s.label}</span>
                    </li>
                  ))}
                </ol>
                {unpinnedNote}
                <div className="mt-3">
                  {routeCheck.applied ? (
                    <p className="text-xs font-medium text-amber-800">
                      List reordered — press Save Order to make it the driver's order.
                    </p>
                  ) : (
                    <Button size="sm" variant="outline" className="border-amber-400 text-amber-900 hover:bg-amber-100" onClick={handleUseSuggestedOrder}>
                      Use this order
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {canCheckRoute && orderedJobs.length >= 2 && (
                <Button
                  variant="outline"
                  onClick={handleCheckRoute}
                  disabled={routeCheck?.status === 'loading'}
                >
                  <Route className="w-4 h-4 mr-2 text-amber-600" />
                  Check route
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={orderedJobs.length === 0 || isSaving}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Save Order
              </Button>
            </div>
          </div>
        </div>

        {/* Right column: the route map, stretching to the popup's height —
            pins and route line follow the list order on the left */}
        <div className="w-full md:w-[45%] shrink-0 flex flex-col gap-1">
          <div className="relative flex-1 min-h-[300px]">
            <div className="absolute inset-0 z-0">
              <StopsMap stops={mapStops} home={home} height="100%" />
            </div>
            {mapStops.length === 0 && (
              <div className="absolute inset-x-3 top-3 z-10 bg-white/95 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 shadow-sm pointer-events-none" style={{ transform: 'translateZ(0)' }}>
                {selectedDriverId ? 'No mapped stops for this day yet.' : "Pick a driver and the day's route appears here."}
              </div>
            )}
          </div>
          {unmappedCount > 0 && (
            <p className="text-[11px] text-gray-400">
              {unmappedCount} stop{unmappedCount !== 1 ? 's' : ''} not shown (address not map-verified yet)
            </p>
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}