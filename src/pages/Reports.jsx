import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/entities';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { FilterDropdown, ActiveChip, encodeFilterParams } from "@/components/reports/filters";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import {
  Loader2, Package, BarChart2, Users, Building2, ChevronDown, ChevronUp,
  ExternalLink, Calendar as CalendarIcon, Truck, MapPin, Tag, X,
  Hash, Layers,
} from "lucide-react";
import {
  format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, subDays, subMonths,
} from "date-fns";

// ─── Date presets (used inside the date popover sidebar) ──────────────────
function computePreset(key, now, earliestJobDate) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (key) {
    case 'today':     return { from: today, to: today };
    case 'thisWeek':  return { from: startOfWeek(today, { weekStartsOn: 1 }), to: endOfWeek(today, { weekStartsOn: 1 }) };
    case 'last7':     return { from: subDays(today, 6), to: today };
    case 'mtd':       return { from: startOfMonth(today), to: today };
    case 'lastMonth': {
      const prev = subMonths(today, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case 'ytd':       return { from: startOfYear(today), to: today };
    case 'allTime':   return { from: earliestJobDate || today, to: today };
    default:          return { from: startOfMonth(today), to: today };
  }
}

const SIDEBAR_PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'thisWeek',  label: 'This Week' },
  { key: 'last7',     label: 'Last 7 Days' },
  { key: 'mtd',       label: 'Month to Date' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'ytd',       label: 'Year to Date' },
  { key: 'allTime',   label: 'All Time' },
];

function formatRangeLabel(range) {
  if (!range?.from || !range?.to) return '';
  const sameDay = range.from.getTime() === range.to.getTime();
  if (sameDay) return format(range.from, 'MMM d, yyyy');
  const sameYear = range.from.getFullYear() === range.to.getFullYear();
  if (sameYear) return `${format(range.from, 'MMM d')} – ${format(range.to, 'MMM d, yyyy')}`;
  return `${format(range.from, 'MMM d, yyyy')} – ${format(range.to, 'MMM d, yyyy')}`;
}

// ─── Date Range Picker ────────────────────────────────────────────────────
function DateRangePicker({ value, onChange, earliestJobDate }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('range'); // 'single' or 'range'
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const applyPreset = (presetKey) => {
    onChange(computePreset(presetKey, new Date(), earliestJobDate));
    setOpen(false);
  };

  const apply = () => {
    if (mode === 'single' && draft?.from) {
      onChange({ from: draft.from, to: draft.from });
    } else if (mode === 'range' && draft?.from && draft?.to) {
      onChange(draft);
    } else if (mode === 'range' && draft?.from && !draft?.to) {
      // single tap in range mode = treat as one day
      onChange({ from: draft.from, to: draft.from });
    }
    setOpen(false);
  };

  const canApply = mode === 'single'
    ? !!draft?.from
    : !!(draft?.from);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors",
          "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
        )}>
          <CalendarIcon className="w-3.5 h-3.5 text-amber-600" />
          <span>{formatRangeLabel(value) || 'Date'}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          {/* LEFT: Calendar */}
          <div className="p-3 sm:border-r border-b sm:border-b-0">
            {/* Single / Range toggle */}
            <div className="inline-flex bg-gray-100 rounded-md p-0.5 mb-3 w-full">
              <button
                onClick={() => {
                  setMode('single');
                  if (draft?.from) setDraft({ from: draft.from, to: draft.from });
                }}
                className={cn(
                  "flex-1 px-3 py-1 text-xs font-medium rounded transition-all",
                  mode === 'single' ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
                )}
              >
                Single Date
              </button>
              <button
                onClick={() => setMode('range')}
                className={cn(
                  "flex-1 px-3 py-1 text-xs font-medium rounded transition-all",
                  mode === 'range' ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
                )}
              >
                Date Range
              </button>
            </div>
            {mode === 'single' ? (
              <Calendar
                mode="single"
                selected={draft?.from}
                onSelect={(d) => setDraft(d ? { from: d, to: d } : {})}
                defaultMonth={draft?.from || new Date()}
              />
            ) : (
              <Calendar
                mode="range"
                selected={draft}
                onSelect={(r) => setDraft(r || {})}
                defaultMonth={draft?.from || new Date()}
                numberOfMonths={1}
              />
            )}
            <div className="flex justify-between items-center mt-2 gap-2">
              <p className="text-xs text-gray-500">
                {draft?.from && draft?.to
                  ? formatRangeLabel(draft)
                  : draft?.from
                    ? `Start: ${format(draft.from, 'MMM d')}`
                    : 'Pick a date'}
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  className="h-7 px-3 bg-amber-600 hover:bg-amber-700"
                  onClick={apply}
                  disabled={!canApply}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>

          {/* RIGHT: Quick presets */}
          <div className="p-2 w-full sm:w-44 bg-gray-50/50">
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider px-2 py-1.5">Quick</p>
            <div className="flex flex-col">
              {SIDEBAR_PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className="w-full text-left px-3 py-1.5 text-sm rounded text-gray-700 hover:bg-amber-100 hover:text-amber-800 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}


// ─── KPI Card ──────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, suffix, color }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", color)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
          <p className="font-bold text-2xl text-gray-900 leading-tight">
            {typeof value === 'number' ? value.toLocaleString() : value}
            {suffix && <span className="text-sm text-gray-400 font-medium ml-1">{suffix}</span>}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
export default function Reports() {
  const [jobs, setJobs] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [pickupLocations, setPickupLocations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Date range — initialized to MTD on load
  const [dateRange, setDateRange] = useState(() => computePreset('mtd', new Date(), null));

  // Filter state
  const [filterDrivers, setFilterDrivers] = useState(new Set());
  const [filterCustomers, setFilterCustomers] = useState(new Set());
  const [filterPickupLocs, setFilterPickupLocs] = useState(new Set());
  const [filterJobTypes, setFilterJobTypes] = useState(new Set());
  const [filterTruckTypes, setFilterTruckTypes] = useState(new Set());

  // Drill-down state
  const [expandedDrivers, setExpandedDrivers] = useState({});
  const [expandedLocations, setExpandedLocations] = useState({});
  const [expandedCustomers, setExpandedCustomers] = useState({});

  // Show-more toggles for the pickup-location and customer cards
  const [showAllPickup, setShowAllPickup] = useState(false);
  const [showAllCustomers, setShowAllCustomers] = useState(false);

  const PREVIEW_COUNT = 3;
  const EXPANDED_COUNT = 15;

  useEffect(() => {
    const load = async () => {
      const [j, d, c, p] = await Promise.all([
        base44.entities.Job.list('-scheduled_date', 5000),
        base44.entities.Driver.list(),
        base44.entities.Customer.list(undefined, 5000),
        base44.entities.PickupLocation.list(),
      ]);
      setJobs(j);
      setDrivers(d);
      setCustomers(c);
      setPickupLocations(p);
      setIsLoading(false);
    };
    load();
  }, []);

  // Earliest job date — used for "All Time" preset
  const earliestJobDate = useMemo(() => {
    if (jobs.length === 0) return null;
    const dates = jobs.map(j => j.scheduled_date).filter(Boolean).sort();
    return dates.length > 0 ? parseISO(dates[0]) : null;
  }, [jobs]);

  // Filtered jobs
  const filteredJobs = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return [];
    return jobs.filter(j => {
      if (j.status !== 'completed') return false;
      if (!j.scheduled_date) return false;
      const jd = parseISO(j.scheduled_date);
      if (jd < dateRange.from || jd > dateRange.to) return false;
      if (filterDrivers.size > 0 && !filterDrivers.has(j.assigned_driver_id)) return false;
      if (filterCustomers.size > 0 && !filterCustomers.has(j.customer_id)) return false;
      if (filterJobTypes.size > 0 && !filterJobTypes.has(j.job_type)) return false;
      if (filterTruckTypes.size > 0 && !filterTruckTypes.has(j.truck_type)) return false;
      if (filterPickupLocs.size > 0) {
        const matchedById = j.pickup_location_id && filterPickupLocs.has(j.pickup_location_id);
        const matchedByName = j.job_type === 'pickup' && j.location_name &&
          pickupLocations.some(pl => filterPickupLocs.has(pl.id) && pl.name === j.location_name);
        const matchedByLoadEntry = Array.isArray(j.loads) && j.loads.some(l =>
          pickupLocations.some(pl => filterPickupLocs.has(pl.id) && pl.name === l.pickup_location_name)
        );
        if (!matchedById && !matchedByName && !matchedByLoadEntry) return false;
      }
      return true;
    });
  }, [jobs, dateRange, filterDrivers, filterCustomers, filterPickupLocs, filterJobTypes, filterTruckTypes, pickupLocations]);

  // ─── Computed stats ──────────────────────────────────────────────────────
  const supplierLocations = pickupLocations.filter(l => !l.location_type || l.location_type === 'supplier');

  const pickupByLocation = supplierLocations.map(loc => {
    let total = 0;
    filteredJobs.forEach(job => {
      if (job.job_type === 'pickup' && (job.pickup_location_id === loc.id || job.location_name === loc.name)) {
        total += (job.pickup_yards || job.yards_collected || 0);
      }
      if (job.job_type === 'delivery' && Array.isArray(job.loads) && job.loads.length > 0) {
        job.loads.filter(l => l.pickup_location_name === loc.name).forEach(l => {
          total += (l.yards_collected || 0);
        });
      }
      if (job.job_type === 'delivery' && (!Array.isArray(job.loads) || job.loads.length === 0)
          && job.pickup_location_id === loc.id) {
        total += (job.delivery_yards || 0);
      }
    });
    return { name: loc.name, yards: total };
  }).filter(x => x.yards > 0).sort((a, b) => b.yards - a.yards);

  const driverStats = drivers.filter(d => d.role === 'driver').map(driver => {
    const dJobs = filteredJobs.filter(j => j.assigned_driver_id === driver.id);
    const totalLoads = dJobs.reduce((sum, j) => sum + (Number(j.quantity) || 0), 0);
    return { id: driver.id, name: driver.name, totalLoads, type: driver.driver_type, jobs: dJobs };
  }).filter(d => d.totalLoads > 0).sort((a, b) => b.totalLoads - a.totalLoads);

  const deliveryJobs = filteredJobs.filter(j => j.job_type === 'delivery');
  const customerStats = customers.map(c => {
    const cJobs = deliveryJobs.filter(j => j.customer_id === c.id);
    const loads = cJobs.reduce((sum, j) => sum + (Number(j.quantity) || 0), 0);
    const yards = cJobs.reduce((sum, j) => {
      if (Array.isArray(j.loads) && j.loads.length > 0) {
        return sum + j.loads.reduce((s, l) => s + (Number(l.yards_collected) || 0), 0);
      }
      return sum + (Number(j.delivery_yards) || 0);
    }, 0);
    return { id: c.id, name: c.name || c.business_name, loads, yards };
  }).filter(x => x.loads > 0).sort((a, b) => b.loads - a.loads);

  // KPI summary
  const summary = useMemo(() => {
    const totalJobs = filteredJobs.length;
    const totalLoads = filteredJobs.reduce((s, j) => s + (Number(j.quantity) || 0), 0);
    const totalYards = filteredJobs.reduce((s, j) => {
      if (Array.isArray(j.loads) && j.loads.length > 0) {
        return s + j.loads.reduce((ss, l) => ss + (Number(l.yards_collected) || 0), 0);
      }
      return s + (Number(j.pickup_yards) || Number(j.yards_collected) || Number(j.delivery_yards) || 0);
    }, 0);
    const activeDrivers = new Set(filteredJobs.map(j => j.assigned_driver_id).filter(Boolean)).size;
    return { totalJobs, totalLoads, totalYards, activeDrivers };
  }, [filteredJobs]);

  // Drill-down helpers
  const getDriverBreakdown = (driverJobsList) => {
    const map = {};
    driverJobsList.forEach(j => {
      let name;
      if (j.job_type === 'delivery') {
        const cust = customers.find(c => c.id === j.customer_id);
        name = cust?.name || cust?.business_name || j.location_name || 'Unknown';
      } else {
        name = j.location_name || 'Unknown Location';
      }
      map[name] = (map[name] || 0) + (Number(j.quantity) || 0);
    });
    return Object.entries(map).map(([name, loads]) => ({ name, loads })).sort((a, b) => b.loads - a.loads);
  };

  const getPickupLocationDriverBreakdown = (locName, locId) => {
    const map = {};
    filteredJobs.filter(j => j.job_type === 'pickup' && (j.pickup_location_id === locId || j.location_name === locName)).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      if (!drv) return;
      const yards = Number(j.pickup_yards) || Number(j.yards_collected) || 0;
      map[drv.name] = (map[drv.name] || 0) + yards;
    });
    filteredJobs.filter(j => j.job_type === 'delivery' && Array.isArray(j.loads) && j.loads.length > 0).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      if (!drv) return;
      j.loads.filter(l => l.pickup_location_name === locName).forEach(l => {
        map[drv.name] = (map[drv.name] || 0) + (Number(l.yards_collected) || 0);
      });
    });
    filteredJobs.filter(j => j.job_type === 'delivery' && (!Array.isArray(j.loads) || j.loads.length === 0) && j.pickup_location_id === locId).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      if (!drv) return;
      map[drv.name] = (map[drv.name] || 0) + (Number(j.delivery_yards) || 0);
    });
    return Object.entries(map).map(([name, yards]) => ({ name, yards })).sort((a, b) => b.yards - a.yards);
  };

  const getCustomerDriverBreakdown = (customerId) => {
    const loadMap = {};
    const yardMap = {};
    filteredJobs.filter(j => j.customer_id === customerId).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      const name = drv?.name || 'Unknown Driver';
      loadMap[name] = (loadMap[name] || 0) + (Number(j.quantity) || 0);
      let yards = 0;
      if (Array.isArray(j.loads) && j.loads.length > 0) {
        yards = j.loads.reduce((s, l) => s + (Number(l.yards_collected) || 0), 0);
      } else {
        yards = Number(j.delivery_yards) || 0;
      }
      yardMap[name] = (yardMap[name] || 0) + yards;
    });
    return Object.entries(loadMap)
      .map(([name, loads]) => ({ name, loads, yards: yardMap[name] || 0 }))
      .sort((a, b) => b.loads - a.loads);
  };

  // ─── Filter option lists ─────────────────────────────────────────────────
  const driverOptions = drivers
    .filter(d => d.role === 'driver')
    .map(d => ({ value: d.id, label: d.name, hint: d.driver_type }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const customerOptions = customers
    .map(c => ({ value: c.id, label: c.name || c.business_name || 'Unnamed' }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const pickupLocOptions = pickupLocations
    .filter(l => !l.location_type || l.location_type === 'supplier')
    .map(l => ({ value: l.id, label: l.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const jobTypeOptions = [
    { value: 'pickup',   label: 'Pickup' },
    { value: 'delivery', label: 'Delivery' },
  ];

  const truckTypeOptions = [
    { value: 'straight_truck', label: 'Straight Truck' },
    { value: 'semi',           label: 'Semi' },
    { value: 'spreader',       label: 'Spreader' },
  ];

  // Filter button row config — drives the buttons + active chip strip
  const FILTERS = [
    { key: 'driver',    label: 'Driver',          icon: Users,    options: driverOptions,    selected: filterDrivers,    setter: setFilterDrivers,    color: 'amber' },
    { key: 'customer',  label: 'Customer',        icon: Building2, options: customerOptions, selected: filterCustomers,  setter: setFilterCustomers,  color: 'blue'  },
    { key: 'pickup',    label: 'Pickup Location', icon: MapPin,   options: pickupLocOptions, selected: filterPickupLocs, setter: setFilterPickupLocs, color: 'amber' },
    { key: 'jobType',   label: 'Job Type',        icon: Tag,      options: jobTypeOptions,   selected: filterJobTypes,   setter: setFilterJobTypes,   color: 'gray',  searchable: false },
    { key: 'truckType', label: 'Truck Type',      icon: Truck,    options: truckTypeOptions, selected: filterTruckTypes, setter: setFilterTruckTypes, color: 'gray',  searchable: false },
  ];

  const anyFilterActive = FILTERS.some(f => f.selected.size > 0);

  const clearAllFilters = () => {
    FILTERS.forEach(f => f.setter(new Set()));
  };

  // Build chip value strings (names instead of ids)
  const filterValueLabel = (filter) => {
    if (filter.selected.size === 0) return '';
    const labels = filter.options
      .filter(o => filter.selected.has(o.value))
      .map(o => o.label);
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  };

  // URL params for full-report links — includes date range AND all filters
  const fullReportQueryString = useMemo(() => {
    const parts = [];
    if (dateRange?.from && dateRange?.to) {
      parts.push(`from=${format(dateRange.from, 'yyyy-MM-dd')}`);
      parts.push(`to=${format(dateRange.to, 'yyyy-MM-dd')}`);
    }
    const filterStr = encodeFilterParams({
      drivers: filterDrivers,
      customers: filterCustomers,
      pickupLocs: filterPickupLocs,
      jobTypes: filterJobTypes,
      truckTypes: filterTruckTypes,
    });
    if (filterStr) parts.push(filterStr);
    return parts.join('&');
  }, [dateRange, filterDrivers, filterCustomers, filterPickupLocs, filterJobTypes, filterTruckTypes]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  const rangeLabel = formatRangeLabel(dateRange);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-2xl text-gray-900">Reports</h1>
              <p className="text-sm text-gray-500">Miller Sawdust Dispatch Analytics</p>
            </div>
          </div>
        </div>

        {/* Filter button row — date + all filters on one line */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            earliestJobDate={earliestJobDate}
          />
          <div className="w-px h-6 bg-gray-200 mx-1" />
          {FILTERS.map(f => (
            <FilterDropdown
              key={f.key}
              icon={f.icon}
              label={f.label}
              options={f.options}
              selected={f.selected}
              onChange={f.setter}
              searchable={f.searchable !== false}
            />
          ))}
        </div>

        {/* Active filter chip strip — only when non-date filters are active */}
        {anyFilterActive && (
          <div className="flex items-center gap-2 flex-wrap mb-5">
            <span className="text-xs text-gray-500 uppercase font-bold tracking-wider mr-1">Showing:</span>
            {FILTERS.map(f => f.selected.size > 0 && (
              <ActiveChip
                key={f.key}
                icon={f.icon}
                label={f.label}
                value={filterValueLabel(f)}
                color={f.color}
                onRemove={() => f.setter(new Set())}
              />
            ))}
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium text-red-700 hover:bg-red-50"
            >
              <X className="w-3.5 h-3.5" /> Clear all
            </button>
          </div>
        )}

        {/* Summary KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <KPICard icon={Hash}    label="Jobs"           value={summary.totalJobs}     color="bg-gray-700" />
          <KPICard icon={Layers}  label="Loads"          value={summary.totalLoads}    color="bg-blue-600" />
          <KPICard icon={Package} label="Yards"          value={summary.totalYards}    suffix="yds" color="bg-amber-600" />
          <KPICard icon={Users}   label="Active Drivers" value={summary.activeDrivers} color="bg-emerald-600" />
        </div>

        {/* Empty state */}
        {filteredJobs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500 text-sm">No completed jobs match this filter combination.</p>
              <p className="text-gray-400 text-xs mt-1">Try widening the date range or clearing filters.</p>
            </CardContent>
          </Card>
        )}

        {filteredJobs.length > 0 && (
        <>
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Yards by Pickup Location */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-600" />
                Yards by Pickup Location
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pickupByLocation.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">No pickup data</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={pickupByLocation} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v) => [`${v} yds`, 'Yards']} />
                      <Bar dataKey="yards" fill="#d97706" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <table className="w-full mt-3 text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-xs text-gray-500 font-medium pb-1">Location</th>
                        <th className="text-right text-xs text-gray-500 font-medium pb-1">Yards Collected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pickupByLocation.slice(0, showAllPickup ? EXPANDED_COUNT : PREVIEW_COUNT).map((loc, idx) => {
                        const locObj = pickupLocations.find(l => l.name === loc.name);
                        const breakdown = getPickupLocationDriverBreakdown(loc.name, locObj?.id);
                        const isExpanded = expandedLocations[loc.name];
                        return (
                          <React.Fragment key={loc.name}>
                            <tr
                              className={cn("cursor-pointer", idx % 2 === 0 ? 'bg-gray-50' : 'bg-white', 'hover:bg-amber-50 transition-colors')}
                              onClick={() => setExpandedLocations(p => ({ ...p, [loc.name]: !p[loc.name] }))}
                            >
                              <td className="py-2 px-1 text-gray-700 flex items-center gap-1">
                                {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
                                {loc.name}
                              </td>
                              <td className="py-2 px-1 text-right font-semibold text-amber-700">{loc.yards.toLocaleString()} yds</td>
                            </tr>
                            {isExpanded && breakdown.map((b) => (
                              <tr key={b.name} className="bg-amber-50/50">
                                <td className="py-1.5 pl-6 pr-1 text-gray-600 text-xs">↳ {b.name}</td>
                                <td className="py-1.5 px-1 text-right text-xs font-semibold text-amber-600">{b.yards.toLocaleString()} yds</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  {pickupByLocation.length > PREVIEW_COUNT && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-center gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllPickup(s => !s)}
                        className="gap-1 text-amber-700 hover:bg-amber-50"
                      >
                        {showAllPickup ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            Show less
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            Show {Math.min(pickupByLocation.length, EXPANDED_COUNT) - PREVIEW_COUNT} more
                          </>
                        )}
                      </Button>
                      {pickupByLocation.length > EXPANDED_COUNT && (
                        <Link to={`/PickupLocationsFullReport?${fullReportQueryString}`}>
                          <Button variant="outline" size="sm" className="gap-2 text-amber-700 border-amber-300 hover:bg-amber-50">
                            <ExternalLink className="w-3.5 h-3.5" />
                            View full report ({pickupByLocation.length} locations)
                          </Button>
                        </Link>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Customer Deliveries */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" />
                Loads Delivered by Customer
              </CardTitle>
            </CardHeader>
            <CardContent>
              {customerStats.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">No delivery data</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={customerStats.slice(0, 8)} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v) => [`${v} loads`, 'Loads']} />
                      <Bar dataKey="loads" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <table className="w-full mt-3 text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-xs text-gray-500 font-medium pb-1">Customer</th>
                        <th className="text-right text-xs text-gray-500 font-medium pb-1">Loads</th>
                        <th className="text-right text-xs text-gray-500 font-medium pb-1">Yards</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerStats.slice(0, showAllCustomers ? EXPANDED_COUNT : PREVIEW_COUNT).map((c, idx) => {
                        const breakdown = c.id ? getCustomerDriverBreakdown(c.id) : [];
                        const isExpanded = expandedCustomers[c.name];
                        return (
                          <React.Fragment key={c.name}>
                            <tr
                              className={cn("cursor-pointer", idx % 2 === 0 ? 'bg-gray-50' : 'bg-white', 'hover:bg-blue-50 transition-colors')}
                              onClick={() => setExpandedCustomers(p => ({ ...p, [c.name]: !p[c.name] }))}
                            >
                              <td className="py-2 px-1 text-gray-700 flex items-center gap-1 truncate max-w-[120px]">
                                {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />}
                                {c.name}
                              </td>
                              <td className="py-2 px-1 text-right font-semibold text-blue-700">{c.loads}</td>
                              <td className="py-2 px-1 text-right font-semibold text-amber-700">{c.yards.toLocaleString()}</td>
                            </tr>
                            {isExpanded && breakdown.map((b) => (
                              <tr key={b.name} className="bg-blue-50/50">
                                <td className="py-1.5 pl-6 pr-1 text-gray-600 text-xs">↳ {b.name}</td>
                                <td className="py-1.5 px-1 text-right text-xs font-semibold text-blue-600">{b.loads} load{b.loads !== 1 ? 's' : ''}</td>
                                <td className="py-1.5 px-1 text-right text-xs font-semibold text-amber-600">{b.yards.toLocaleString()} yds</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  {customerStats.length > PREVIEW_COUNT && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-center gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllCustomers(s => !s)}
                        className="gap-1 text-blue-700 hover:bg-blue-50"
                      >
                        {showAllCustomers ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            Show less
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            Show {Math.min(customerStats.length, EXPANDED_COUNT) - PREVIEW_COUNT} more
                          </>
                        )}
                      </Button>
                      {customerStats.length > EXPANDED_COUNT && (
                        <Link to={`/CustomerDeliveriesFullReport?${fullReportQueryString}`}>
                          <Button variant="outline" size="sm" className="gap-2 text-blue-700 border-blue-300 hover:bg-blue-50">
                            <ExternalLink className="w-3.5 h-3.5" />
                            View full report ({customerStats.length} customers)
                          </Button>
                        </Link>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Driver Performance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-gray-600" />
              Driver Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {driverStats.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">No driver data for this period</p>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {driverStats.map(d => {
                  const breakdown = getDriverBreakdown(d.jobs);
                  const isExpanded = expandedDrivers[d.id];
                  return (
                    <div key={d.id} className="bg-gray-50 rounded-lg border overflow-hidden">
                      <button
                        className="w-full text-left p-4 hover:bg-gray-100 transition-colors"
                        onClick={() => setExpandedDrivers(prev => ({ ...prev, [d.id]: !prev[d.id] }))}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-gray-900">{d.name}</p>
                            <Badge className={cn(
                              "text-xs mt-0.5",
                              d.type === 'pickup'
                                ? "bg-amber-100 text-amber-700"
                                : "bg-blue-100 text-blue-700"
                            )}>
                              {d.type === 'pickup' ? 'Pickup Driver' : 'Delivery Driver'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <span className="text-2xl font-bold text-gray-900">{d.totalLoads}</span>
                              <p className="text-xs text-gray-400">loads</p>
                            </div>
                            {isExpanded
                              ? <ChevronUp className="w-4 h-4 text-gray-400" />
                              : <ChevronDown className="w-4 h-4 text-gray-400" />
                            }
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="border-t px-4 py-3 bg-white">
                          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                            {d.name} — {d.totalLoads} loads
                          </p>
                          {breakdown.length === 0 ? (
                            <p className="text-xs text-gray-400">No breakdown available</p>
                          ) : (
                            <table className="w-full text-sm">
                              <tbody>
                                {breakdown.map((b, idx) => (
                                  <tr key={b.name} className={idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                                    <td className="py-1.5 px-1 text-gray-700">{b.name}</td>
                                    <td className="py-1.5 px-1 text-right font-semibold text-blue-700">{b.loads} load{b.loads !== 1 ? 's' : ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        </>
        )}
      </div>
    </div>
  );
}
