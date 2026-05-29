import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/entities';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, Building2, ArrowLeft, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO, startOfMonth } from "date-fns";

const PAGE_SIZE = 25;

export default function CustomerDeliveriesFullReport() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromParam = urlParams.get('from');
  const toParam = urlParams.get('to');
  const legacyMonth = urlParams.get('month');

  // Resolve range: prefer from/to, fall back to legacy ?month=, else MTD
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
  const [customers, setCustomers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedCustomers, setExpandedCustomers] = useState({});

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const [j, d, c] = await Promise.all([
        base44.entities.Job.list('-scheduled_date', 5000),
        base44.entities.Driver.list(),
        base44.entities.Customer.list(undefined, 5000),
      ]);
      setJobs(j);
      setDrivers(d);
      setCustomers(c);
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

  const totalPages = Math.ceil(customerStats.length / PAGE_SIZE);
  const paginated = customerStats.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xl text-gray-900">Loads Delivered by Customer</h1>
              <p className="text-sm text-gray-500">{rangeLabel} — {customerStats.length} customers</p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="pt-4">
            {customerStats.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-12">No delivery data for this period</p>
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
                      const globalIdx = page * PAGE_SIZE + idx;
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

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                    <p className="text-sm text-gray-500">
                      Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, customerStats.length)} of {customerStats.length}
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
