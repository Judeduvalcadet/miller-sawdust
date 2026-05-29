import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/entities';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, Package, ArrowLeft, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO, startOfMonth } from "date-fns";

const PAGE_SIZE = 25;

export default function PickupLocationsFullReport() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromParam = urlParams.get('from');
  const toParam = urlParams.get('to');
  const legacyMonth = urlParams.get('month');

  const range = useMemo(() => {
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

  const [page, setPage] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [pickupLocations, setPickupLocations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedLocations, setExpandedLocations] = useState({});

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const [j, d, p] = await Promise.all([
        base44.entities.Job.list('-scheduled_date', 5000),
        base44.entities.Driver.list(),
        base44.entities.PickupLocation.list(),
      ]);
      setJobs(j);
      setDrivers(d);
      setPickupLocations(p);
      setIsLoading(false);
    };
    load();
  }, []);

  const filteredJobs = jobs.filter(j => {
    if (j.status !== 'completed') return false;
    if (!j.scheduled_date) return false;
    const jd = parseISO(j.scheduled_date);
    return jd >= range.from && jd <= range.to;
  });

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

  const totalPages = Math.ceil(pickupByLocation.length / PAGE_SIZE);
  const paginated = pickupByLocation.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const sameDay = range.from.getTime() === range.to.getTime();
  const sameYear = range.from.getFullYear() === range.to.getFullYear();
  const rangeLabel = sameDay
    ? format(range.from, 'MMM d, yyyy')
    : sameYear
      ? `${format(range.from, 'MMM d')} – ${format(range.to, 'MMM d, yyyy')}`
      : `${format(range.from, 'MMM d, yyyy')} – ${format(range.to, 'MMM d, yyyy')}`;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
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
              <p className="text-sm text-gray-500">{rangeLabel} — {pickupByLocation.length} locations</p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4">
            {pickupByLocation.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-12">No pickup data for this period</p>
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
                      const globalIdx = page * PAGE_SIZE + idx;
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

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                    <p className="text-sm text-gray-500">
                      Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, pickupByLocation.length)} of {pickupByLocation.length}
                    </p>
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
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
