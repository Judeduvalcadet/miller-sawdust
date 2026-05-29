import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/entities';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterDropdown, ActiveChip, decodeFilterParams } from "@/components/reports/filters";
import { cn } from "@/lib/utils";
import {
  Loader2, Building2, ArrowLeft, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Calendar as CalendarIcon, Users, MapPin, Tag, Truck,
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

export default function CustomerDeliveriesFullReport() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromParam = urlParams.get('from');
  const toParam = urlParams.get('to');
  const legacyMonth = urlParams.get('month');

  // Date range read-only from URL on this page
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

  // Filter state — initialized from URL, editable on this page
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
  const [expandedCustomers, setExpandedCustomers] = useState({});

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

  // Jobs in date range (no other filters yet)
  const inDateRangeJobs = useMemo(() => {
    return jobs.filter(j => {
      if (j.status !== 'completed') return false;
      if (!j.scheduled_date) return false;
      const jd = parseISO(j.scheduled_date);
      return jd >= dateRange.from && jd <= dateRange.to;
    });
  }, [jobs, dateRange]);

  // All filters applied
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

  const getDriverBreakdown = (customerId) => {
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
    return Object.entries(loadMap).map(([name, loads]) => ({ name, loads, yards: yardMap[name] || 0 })).sort((a, b) => b.loads - a.loads);
  };

  // "Available" sets — derived from the date-filtered jobs (no other filters).
  // Used to gray out dropdown options that have no data in the current date window.
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

  // Reset page on filter/page-size change
  useEffect(() => { setPage(0); }, [filterDrivers, filterCustomers, filterPickupLocs, filterJobTypes, filterTruckTypes, pageSize]);

  const totalPages = Math.max(1, Math.ceil(customerStats.length / pageSize));
  const paginated = customerStats.slice(page * pageSize, (page + 1) * pageSize);
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
        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link to={`/Reports`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xl text-gray-900">Loads Delivered by Customer</h1>
              <p className="text-sm text-gray-500">{customerStats.length} customers</p>
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

        {/* Chip strip — date chip is always shown (it's locked on this page) */}
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
            {customerStats.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-12">No delivery data for this filter combination</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left text-xs text-gray-500 font-medium pb-2 px-2">#</th>
                      <th className="text-left text-xs text-gray-500 font-medium pb-2 px-2">Customer</th>
                      <th className="text-right text-xs text-gray-500 font-medium pb-2 px-2">Loads</th>
                      <th className="text-right text-xs text-gray-500 font-medium pb-2 px-2">Yards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((c, idx) => {
                      const globalIdx = page * pageSize + idx;
                      const breakdown = c.id ? getDriverBreakdown(c.id) : [];
                      const isExpanded = expandedCustomers[c.name];
                      return (
                        <React.Fragment key={c.name}>
                          <tr
                            className={cn("cursor-pointer", idx % 2 === 0 ? 'bg-gray-50' : 'bg-white', 'hover:bg-blue-50 transition-colors')}
                            onClick={() => setExpandedCustomers(p => ({ ...p, [c.name]: !p[c.name] }))}
                          >
                            <td className="py-2.5 px-2 text-gray-400 text-xs">{globalIdx + 1}</td>
                            <td className="py-2.5 px-2 text-gray-700 flex items-center gap-1">
                              {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />}
                              {c.name}
                            </td>
                            <td className="py-2.5 px-2 text-right font-semibold text-blue-700">{c.loads}</td>
                            <td className="py-2.5 px-2 text-right font-semibold text-amber-700">{c.yards.toLocaleString()}</td>
                          </tr>
                          {isExpanded && breakdown.map((b) => (
                            <tr key={b.name} className="bg-blue-50/50">
                              <td className="py-1.5 px-2" />
                              <td className="py-1.5 pl-6 pr-2 text-gray-600 text-xs">↳ {b.name}</td>
                              <td className="py-1.5 px-2 text-right text-xs font-semibold text-blue-600">{b.loads} load{b.loads !== 1 ? 's' : ''}</td>
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
                      Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, customerStats.length)} of {customerStats.length}
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
