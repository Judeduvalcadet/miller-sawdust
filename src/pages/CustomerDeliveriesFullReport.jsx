import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/entities';
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, Building2, ArrowLeft, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";

const PAGE_SIZE = 25;

export default function CustomerDeliveriesFullReport() {
  const urlParams = new URLSearchParams(window.location.search);
  const [selectedMonth, setSelectedMonth] = useState(urlParams.get('month') || '');
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
      if (!selectedMonth && j.length > 0) {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const months = [...new Set(j.map(job => job.scheduled_date?.slice(0, 7)))].filter(Boolean).sort().reverse();
        setSelectedMonth(months.includes(currentMonth) ? currentMonth : (months[0] || ''));
      }
      setIsLoading(false);
    };
    load();
  }, []);

  const availableMonths = [...new Set(jobs.map(j => j.scheduled_date?.slice(0, 7)).filter(Boolean))].sort().reverse();

  const filteredJobs = jobs.filter(j =>
    j.status === 'completed' && selectedMonth && j.scheduled_date?.slice(0, 7) === selectedMonth
  );

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

  const getDriverBreakdown = (customerId) => {
    const loadMap = {};
    const yardMap = {};
    filteredJobs.filter(j => j.customer_id === customerId).forEach(j => {
      const drv = drivers.find(d => d.id === j.assigned_driver_id);
      const name = drv?.name || 'Unknown Driver';
      loadMap[name] = (loadMap[name] || 0) + (Number(j.quantity) || 0);
      let yards = 0;
      if (j.truck_type === 'spreader' && Array.isArray(j.loads)) {
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
  const monthLabel = selectedMonth ? format(parseISO(selectedMonth + '-01'), 'MMMM yyyy') : '';

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
        {/* Header */}
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
              <p className="text-sm text-gray-500">{monthLabel} — {customerStats.length} customers</p>
            </div>
          </div>
          <Select value={selectedMonth} onValueChange={(v) => { setSelectedMonth(v); setPage(0); }}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select month..." />
            </SelectTrigger>
            <SelectContent>
              {availableMonths.map(m => (
                <SelectItem key={m} value={m}>{format(parseISO(m + '-01'), 'MMMM yyyy')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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

                {/* Pagination */}
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