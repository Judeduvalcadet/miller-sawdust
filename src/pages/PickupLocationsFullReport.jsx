import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/entities';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterDropdown, ActiveChip, decodeFilterParams } from "@/components/reports/filters";
import { cn } from "@/lib/utils";
import {
  Loader2, Package, ArrowLeft, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Calendar as CalendarIcon, Users, Building2, MapPin, Tag, Truck,
} from "lucide-react";
import { format, parseISO, startOfMonth } from "date-fns";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function formatRangeLabel(range) {
  if (!range?.from || !range?.to) return '';
  const sameDay = range.from.getTime() === range.to.getTime();
  if (sameDay) return format(range.from, 'MMM d, yyyy');
  const sameYear = range.from.getFullYear() === range.to.getFullYear();
  if (sameYear) return `${format(range.from, 'MMM d')} – ${format(range.to, 'MMM d, yyyy')}`;
  return `${format(range.from, 'MMM d, yyyy')} – ${format(range.to, 'MMM d, yyyy')}`;
}

export default function PickupLocationsFullReport() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromParam = urlParams.get('from');
  const toParam = urlParams.get('to');
  const legacyMonth = urlParams.get('month');

  const dateRange = useMemo(() => {
    if (fromParam && toParam) {
      return { from: parseISO(fromParam), to: parseISO(toParam) };
    }
    if (legacyMonth) {
      const start = parseISO(legacyMonth + '-01');
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      return { from: start, to: end };
    }
    const today = new Date();
    return { from: startOfMonth(today), to: today };
  }, [fromParam, toParam, legacyMonth]);

  const initialFilters = useMemo(() => decodeFilterParams(urlParams), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [filterDrivers, setFilterDrivers] = useState(initialFilters.drivers);
  const [filterCustomers, setFilterCustomers] = useState(initialFilters.customers);
  const [filterPickupLocs, setFilterPickupLocs] = useState(initialFilters.pickupLocs);
  const [filterJobTypes, setFilterJobTypes] = useState(initialFilters.jobTypes);
  const [filterTruckTypes, setFilterTruckTypes] = useState(initialFilters.truckTypes);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [jobs, setJobs] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [pickupLocations, setPickupLocations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedLocations, setExpandedLocations] = useState({});

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
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

  const inDateRangeJobs = useMemo(() => {
    return jobs.filter(j => {
      if (j.status !== 'completed') return false;
      if (!j.scheduled_date) return false;
      const jd = parseISO(j.scheduled_date);
      return jd >= dateRange.from && jd <= dateRange.to;
    });
  }, [jobs, dateRange]);

  const filteredJobs = useMemo(() => {
    return inDateRangeJobs.filter(j => {
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
  }, [inDateRangeJobs, filterDrivers, filterCustomers, filterPickupLocs, filterJobTypes, filterTruckTypes, pickupLocations]);

  const supplierLocations = pickupLocations.filter(l => !l.location_type || l.location_type === 'supplier');

  const pickupByLocation = supplierLocations.map(loc => {
    let totalYards = 0;
    filteredJobs.forEach(job => {
      if (job.job_type === 'pickup' && (job.pickup_location_id === loc.id || job.location_name === loc.name)) {
        totalYards += (job.pickup_yards || job.yards_collected || 0);
      }
      if (job.job_type === 'delivery' && Array.isArray(job.loads) && job.loads.length > 0) {
        job.loads.filter(l => l.pickup_location_name === loc.name).forEach(l => {
          totalYards += (l.yards_collected || 0);
        });
      }
      if (job.job_type === 'delivery' && (!Array.isArray(job.loads) || job.loads.length === 0)
          && job.pickup_location_id === loc.id) {
        totalYards += (job.delivery_yards || 0);
      }
    });
    return { name: loc.name, yards: totalYards };
  }).filter(x => x.yards > 0).sort((a, b) => b.yards - a.yards);

  const getDriverBreakdown = (locName, locId) => {
    const map = {};
    filteredJobs.filter(j => j.job_type === 'pickup' && (j.pickup_location_id === locId || j.location_name === locName)).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      if (!drv) return;
      map[drv.name] = (map[drv.name] || 0) + (Number(j.pickup_yards) || Number(j.yards_collected) || 0);
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

  // Available sets (within date range, ignoring other filters) — for gray-out logic
  const availableDriverIds = useMemo(
    () => new Set(inDateRangeJobs.map(j => j.assigned_driver_id).filter(Boolean)),
    [inDateRangeJobs]
  );
  const availableCustomerIds = useMemo(
    () => new Set(inDateRangeJobs.filter(j => j.job_type === 'delivery').map(j => j.customer_id).filter(Boolean)),
    [inDateRangeJobs]
  );
  const availablePickupLocIds = useMemo(() => {
    const set = new Set();
    inDateRangeJobs.forEach(j => {
      if (j.pickup_location_id) set.add(j.pickup_location_id);
      const matchByName = pickupLocations.find(pl => pl.name === j.location_name);
      if (matchByName) set.add(matchByName.id);
      if (Array.isArray(j.loads)) {
        j.loads.forEach(l => {
          const m = pickupLocations.find(pl => pl.name === l.pickup_location_name);
          if (m) set.add(m.id);
        });
      }
    });
    return set;
  }, [inDateRangeJobs, pickupLocations]);
  const availableJobTypes = useMemo(
    () => new Set(inDateRangeJobs.map(j => j.job_type).filter(Boolean)),
    [inDateRangeJobs]
  );
  const availableTruckTypes = useMemo(
    () => new Set(inDateRangeJobs.map(j => j.truck_type).filter(Boolean)),
    [inDateRangeJobs]
  );

  // Filter option lists
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

  const FILTERS = [
    { key: 'driver',    label: 'Driver',          icon: Users,    options: driverOptions,    selected: filterDrivers,    setter: setFilterDrivers,    color: 'amber', available: availableDriverIds },
    { key: 'customer',  label: 'Customer',        icon: Building2, options: customerOptions, selected: filterCustomers,  setter: setFilterCustomers,  color: 'blue',  available: availableCustomerIds },
    { key: 'pickup',    label: 'Pickup Location', icon: MapPin,   options: pickupLocOptions, selected: filterPickupLocs, setter: setFilterPickupLocs, color: 'amber', available: availablePickupLocIds },
    { key: 'jobType',   label: 'Job Type',        icon: Tag,      options: jobTypeOptions,   selected: filterJobTypes,   setter: setFilterJobTypes,   color: 'gray',  available: availableJobTypes,   searchable: false },
    { key: 'truckType', label: 'Truck Type',      icon: Truck,    options: truckTypeOptions, selected: filterTruckTypes, setter: setFilterTruckTypes, color: 'gray',  available: availableTruckTypes, searchable: false },
  ];

  const anyFilterActive = FILTERS.some(f => f.selected.size > 0);

  const clearAllFilters = () => {
    FILTERS.forEach(f => f.setter(new Set()));
    setPage(0);
  };

  const filterValueLabel = (filter) => {
    if (filter.selected.size === 0) return '';
    const labels = filter.options
      .filter(o => filter.selected.has(o.value))
      .map(o => o.label);
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  };

  useEffect(() => { setPage(0); }, [filterDrivers, filterCustomers, filterPickupLocs, filterJobTypes, filterTruckTypes, pageSize]);

  const totalPages = Math.max(1, Math.ceil(pickupByLocation.length / pageSize));
  const paginated = pickupByLocation.slice(page * pageSize, (page + 1) * pageSize);
  const rangeLabel = formatRangeLabel(dateRange);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link to={`/Reports`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xl text-gray-900">Yards by Pickup Location</h1>
              <p className="text-sm text-gray-500">{pickupByLocation.length} locations</p>
            </div>
          </div>
        </div>

        {/* Filter button row */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {FILTERS.map(f => (
            <FilterDropdown
              key={f.key}
              icon={f.icon}
              label={f.label}
              options={f.options}
              selected={f.selected}
              onChange={f.setter}
              searchable={f.searchable !== false}
              availableValues={f.available}
            />
          ))}
        </div>

        {/* Chip strip */}
        <div className="flex items-center gap-2 flex-wrap mb-5">
          <span className="text-xs text-gray-500 uppercase font-bold tracking-wider mr-1">Showing:</span>
          {rangeLabel && (
            <ActiveChip
              icon={CalendarIcon}
              label="Date"
              value={rangeLabel}
              color="amber"
              onRemove={null}
            />
          )}
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
          {anyFilterActive && (
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Clear all
            </button>
          )}
        </div>

        <Card>
          <CardContent className="pt-4">
            {pickupByLocation.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-12">No pickup data for this filter combination</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left text-xs text-gray-500 font-medium pb-2 px-2">#</th>
                      <th className="text-left text-xs text-gray-500 font-medium pb-2 px-2">Location</th>
                      <th className="text-right text-xs text-gray-500 font-medium pb-2 px-2">Yards Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((loc, idx) => {
                      const globalIdx = page * pageSize + idx;
                      const locObj = pickupLocations.find(l => l.name === loc.name);
                      const breakdown = getDriverBreakdown(loc.name, locObj?.id);
                      const isExpanded = expandedLocations[loc.name];
                      return (
                        <React.Fragment key={loc.name}>
                          <tr
                            className={cn("cursor-pointer", idx % 2 === 0 ? 'bg-gray-50' : 'bg-white', 'hover:bg-amber-50 transition-colors')}
                            onClick={() => setExpandedLocations(p => ({ ...p, [loc.name]: !p[loc.name] }))}
                          >
                            <td className="py-2.5 px-2 text-gray-400 text-xs">{globalIdx + 1}</td>
                            <td className="py-2.5 px-2 text-gray-700 flex items-center gap-1">
                              {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
                              {loc.name}
                            </td>
                            <td className="py-2.5 px-2 text-right font-semibold text-amber-700">{loc.yards.toLocaleString()} yds</td>
                          </tr>
                          {isExpanded && breakdown.map((b) => (
                            <tr key={b.name} className="bg-amber-50/50">
                              <td className="py-1.5 px-2" />
                              <td className="py-1.5 pl-6 pr-2 text-gray-600 text-xs">↳ {b.name}</td>
                              <td className="py-1.5 px-2 text-right text-xs font-semibold text-amber-600">{b.yards.toLocaleString()} yds</td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination + page size */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-gray-500">
                      Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, pickupByLocation.length)} of {pickupByLocation.length}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                        <SelectTrigger className="h-7 w-20 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent side="top" sideOffset={4}>
                          {PAGE_SIZE_OPTIONS.map(n => (
                            <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-gray-500">per page</span>
                    </div>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                        <ChevronLeft className="w-4 h-4" />
                        Previous
                      </Button>
                      <span className="text-sm text-gray-600 font-medium">Page {page + 1} of {totalPages}</span>
                      <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
