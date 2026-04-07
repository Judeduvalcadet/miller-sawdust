import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/entities';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { Loader2, Package, Truck, BarChart2, Users, Building2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { format, parseISO } from "date-fns";

export default function Reports() {
  const [jobs, setJobs] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [pickupLocations, setPickupLocations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDriver, setSelectedDriver] = useState(null); // for drill-down modal
  const [expandedDrivers, setExpandedDrivers] = useState({});
  const [expandedLocations, setExpandedLocations] = useState({});
  const [expandedCustomers, setExpandedCustomers] = useState({});

  useEffect(() => {
    const load = async () => {
      const [j, d, c, p] = await Promise.all([
        base44.entities.Job.list('-scheduled_date'),
        base44.entities.Driver.list(),
        base44.entities.Customer.list(),
        base44.entities.PickupLocation.list(),
      ]);
      setJobs(j);
      setDrivers(d);
      setCustomers(c);
      setPickupLocations(p);
      if (j.length > 0) {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const months = [...new Set(j.map(job => job.scheduled_date?.slice(0, 7)))].filter(Boolean).sort().reverse();
        // Default to current month if it has data, otherwise the most recent month
        setSelectedMonth(months.includes(currentMonth) ? currentMonth : (months[0] || ''));
      }
      setIsLoading(false);
    };
    load();
  }, []);

  const availableMonths = [...new Set(jobs.map(j => j.scheduled_date?.slice(0, 7)).filter(Boolean))].sort().reverse();

  const selectedMonthLabel = selectedMonth
    ? format(parseISO(selectedMonth + '-01'), 'MMMM')
    : '';

  const filteredJobs = jobs.filter(j => {
    if (j.status !== 'completed') return false;
    if (!selectedMonth) return false;
    return j.scheduled_date?.slice(0, 7) === selectedMonth;
  });

  // ─── Pickup stats by location ─────────────────────────────────────────────
  const pickupJobs = filteredJobs.filter(j => j.job_type === 'pickup');

  // Only supplier locations count in pickup report (not my_building)
  const supplierLocations = pickupLocations.filter(l => !l.location_type || l.location_type === 'supplier');

  const pickupByLocation = supplierLocations.map(loc => {
    let totalYardsForLocation = 0;

    filteredJobs.forEach(job => {
      // Explicit pickup jobs at this location
      if (job.job_type === 'pickup' && (job.pickup_location_id === loc.id || job.location_name === loc.name)) {
        totalYardsForLocation += (job.pickup_yards || job.yards_collected || 0);
      }
      // Spreader per-load pickup entries inside delivery jobs
      if (job.job_type === 'delivery' && job.truck_type === 'spreader' && Array.isArray(job.loads)) {
        job.loads.filter(l => l.pickup_location_name === loc.name).forEach(loadEntry => {
          totalYardsForLocation += (loadEntry.yards_collected || 0);
        });
      }
      // Delivery jobs that reference this supplier as the pickup location — use delivery_yards
      if (
        job.job_type === 'delivery' &&
        job.truck_type !== 'spreader' &&
        (job.pickup_location_id === loc.id)
      ) {
        totalYardsForLocation += (job.delivery_yards || 0);
      }
    });
    return { name: loc.name, yards: totalYardsForLocation };
  }).filter(x => x.yards > 0).sort((a, b) => b.yards - a.yards);

  // ─── Driver performance (ALL jobs) ───────────────────────────────────────
  const driverStats = drivers.filter(d => d.role === 'driver').map(driver => {
    const dJobs = filteredJobs.filter(j => j.assigned_driver_id === driver.id);
    const totalLoads = dJobs.reduce((sum, j) => sum + (Number(j.quantity) || 0), 0);
    return { id: driver.id, name: driver.name, totalLoads, type: driver.driver_type, jobs: dJobs };
  }).filter(d => d.totalLoads > 0).sort((a, b) => b.totalLoads - a.totalLoads);

  // ─── Customer delivery stats ──────────────────────────────────────────────
  const deliveryJobs = filteredJobs.filter(j => j.job_type === 'delivery');
  const customerStats = customers.map(c => {
    const cJobs = deliveryJobs.filter(j => j.customer_id === c.id);
    const loads = cJobs.reduce((sum, j) => sum + (Number(j.quantity) || 0), 0);
    const yards = cJobs.reduce((sum, j) => {
      if (j.truck_type === 'spreader' && Array.isArray(j.loads)) {
        return sum + j.loads.reduce((s, l) => s + (Number(l.yards_collected) || 0), 0);
      }
      return sum + (Number(j.delivery_yards) || 0);
    }, 0);
    return { id: c.id, name: c.name || c.business_name, loads, yards };
  }).filter(x => x.loads > 0).sort((a, b) => b.loads - a.loads);

  // ─── Summary stats ────────────────────────────────────────────────────────
  const totalYards = pickupJobs.reduce((sum, j) => sum + (j.pickup_yards || j.yards_collected || 0), 0);
  const totalLoads = deliveryJobs.reduce((sum, j) => sum + (Number(j.quantity) || 0), 0);

  // ─── Driver drill-down: breakdown by location/customer (ALL job types) ───
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

  // ─── Pickup location drill-down by driver ─────────────────────────────────
  const getPickupLocationDriverBreakdown = (locName, locId) => {
    const map = {};
    // Jon's direct pickup jobs
    filteredJobs.filter(j => j.job_type === 'pickup' && (j.pickup_location_id === locId || j.location_name === locName)).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      if (!drv) return;
      const yards = Number(j.pickup_yards) || Number(j.yards_collected) || 0;
      map[drv.name] = (map[drv.name] || 0) + yards;
    });
    // Spreader per-load pickup entries inside delivery jobs
    filteredJobs.filter(j => j.job_type === 'delivery' && j.truck_type === 'spreader' && Array.isArray(j.loads)).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      if (!drv) return;
      j.loads.filter(l => l.pickup_location_name === locName).forEach(l => {
        map[drv.name] = (map[drv.name] || 0) + (Number(l.yards_collected) || 0);
      });
    });
    // Other delivery jobs that reference this location — use delivery_yards
    filteredJobs.filter(j => j.job_type === 'delivery' && j.truck_type !== 'spreader' && j.pickup_location_id === locId).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      if (!drv) return;
      map[drv.name] = (map[drv.name] || 0) + (Number(j.delivery_yards) || 0);
    });
    return Object.entries(map).map(([name, yards]) => ({ name, yards })).sort((a, b) => b.yards - a.yards);
  };

  // ─── Customer drill-down by driver ────────────────────────────────────────
  const getCustomerDriverBreakdown = (customerId) => {
    const map = {};
    filteredJobs.filter(j => j.customer_id === customerId).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      const name = drv?.name || 'Unknown Driver';
      const loads = Number(j.quantity) || 0;
      if (!map[name]) map[name] = 0;
      map[name] += loads;
    });
    const yardMap = {};
    filteredJobs.filter(j => j.customer_id === customerId).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      const name = drv?.name || 'Unknown Driver';
      let yards = 0;
      if (j.truck_type === 'spreader' && Array.isArray(j.loads)) {
        yards = j.loads.reduce((s, l) => s + (Number(l.yards_collected) || 0), 0);
      } else {
        yards = Number(j.delivery_yards) || 0;
      }
      yardMap[name] = (yardMap[name] || 0) + yards;
    });
    return Object.entries(map).map(([name, loads]) => ({ name, loads, yards: yardMap[name] || 0 })).sort((a, b) => b.loads - a.loads);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-2xl text-gray-900">
                {selectedMonthLabel ? `Reports for ${selectedMonthLabel}` : 'Reports'}
              </h1>
              <p className="text-sm text-gray-500">Miller Sawdust Dispatch Analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select month..." />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map(m => (
                  <SelectItem key={m} value={m}>
                    {format(parseISO(m + '-01'), 'MMMM yyyy')}
                  </SelectItem>
                ))}
                {availableMonths.length === 0 && (
                  <SelectItem value="none" disabled>No data yet</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>


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
                      {pickupByLocation.slice(0, 15).map((loc, idx) => {
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
                            {isExpanded && breakdown.map((b, bi) => (
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
                  {pickupByLocation.length > 15 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 text-center">
                      <Link to={`/PickupLocationsFullReport?month=${selectedMonth}`}>
                        <Button variant="outline" size="sm" className="gap-2 text-amber-700 border-amber-300 hover:bg-amber-50">
                          <ExternalLink className="w-3.5 h-3.5" />
                          View full report ({pickupByLocation.length} locations)
                        </Button>
                      </Link>
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
                      {customerStats.slice(0, 15).map((c, idx) => {
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
                            {isExpanded && breakdown.map((b, bi) => (
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
                  {customerStats.length > 15 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 text-center">
                      <Link to={`/CustomerDeliveriesFullReport?month=${selectedMonth}`}>
                        <Button variant="outline" size="sm" className="gap-2 text-blue-700 border-blue-300 hover:bg-blue-50">
                          <ExternalLink className="w-3.5 h-3.5" />
                          View full report ({customerStats.length} customers)
                        </Button>
                      </Link>
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
              <div className="grid md:grid-cols-2 gap-4">
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
                            {d.name} — {d.totalLoads} loads in {selectedMonthLabel}
                          </p>
                          {breakdown.length === 0 ? (
                            <p className="text-xs text-gray-400">No delivery breakdown available</p>
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
      </div>


    </div>
  );
}