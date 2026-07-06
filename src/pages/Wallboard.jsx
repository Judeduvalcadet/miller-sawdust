import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isToday } from 'date-fns';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ChevronLeft, ChevronRight, Plus, RefreshCw, Monitor, Filter
} from "lucide-react";
import WallboardJobCard from "@/components/wallboard/WallboardJobCard";
import QuickJobForm from "@/components/wallboard/QuickJobForm";
import WallboardJobDetailPopup from "@/components/wallboard/WallboardJobDetailPopup";
import { cn } from "@/lib/utils";

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export default function Wallboard() {
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [quickJobDate, setQuickJobDate] = useState(null);
  const [userRole, setUserRole] = useState('viewer');
  const [filterDriver, setFilterDriver] = useState('all');
  const [filterCustomer, setFilterCustomer] = useState('all');
  const [filterPickupLocation, setFilterPickupLocation] = useState('all');
  const [filterTruckType, setFilterTruckType] = useState('all');
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => {
    setFilterDriver('all');
    setFilterCustomer('all');
    setFilterPickupLocation('all');
    setFilterTruckType('all');
  }, [weekOffset]);

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekDays = DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(addDays(weekStart, 5), 'yyyy-MM-dd'); // exclusive (Sat)

  // Determine current user role from local session
  useEffect(() => {
    const sessionStr = localStorage.getItem('driverSession');
    if (sessionStr) {
      try {
        const session = JSON.parse(sessionStr);
        setUserRole(session.role || 'driver');
      } catch {}
    }
  }, []);

  // Fetch only jobs scheduled within the visible Mon–Fri window.
  // Updates flow primarily from the realtime subscription below; the 60s
  // refetchInterval is a safety net if the websocket drops silently.
  const { data: jobs = [], refetch: refetchJobs } = useQuery({
    queryKey: ['wallboard-jobs', weekStartStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .gte('scheduled_date', weekStartStr)
        .lt('scheduled_date', weekEndStr)
        .order('scheduled_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  // Realtime: invalidate the wallboard query on any job INSERT/UPDATE/DELETE
  // so the board updates the instant something changes, without polling.
  useEffect(() => {
    const unsubscribe = base44.entities.Job.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ['wallboard-jobs'] });
    });
    return unsubscribe;
  }, [queryClient]);

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => base44.entities.Driver.list(),
    refetchInterval: 30000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list(undefined, 5000),
  });

  const { data: pickupLocations = [] } = useQuery({
    queryKey: ['pickupLocations'],
    queryFn: () => base44.entities.PickupLocation.list('name'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ jobId, driverId }) => {
      const driver = drivers.find(d => d.id === driverId);
      return base44.entities.Job.update(jobId, {
        assigned_driver_id: driverId || null,
        assigned_driver_name: driver?.name || null
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wallboard-jobs'] })
  });

  const createJobMutation = useMutation({
    mutationFn: (data) => base44.entities.Job.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallboard-jobs'] });
      setQuickJobDate(null);
    }
  });

  // Jobs for the current week (unfiltered, for building filter options)
  const weekJobsAll = jobs.filter(j => {
    const dateStr = j.scheduled_date;
    return weekDays.some(d => format(d, 'yyyy-MM-dd') === dateStr) && j.status !== 'cancelled';
  });

  const weekDriverIds = [...new Set(weekJobsAll.map(j => j.assigned_driver_id).filter(Boolean))];
  const weekCustomerIds = [...new Set(weekJobsAll.map(j => j.customer_id).filter(Boolean))];
  const weekPickupLocationIds = [...new Set(weekJobsAll.map(j => j.pickup_location_id).filter(Boolean))];

  const getJobsForDay = (day) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    return jobs.filter(j => {
      if (j.scheduled_date !== dateStr || j.status === 'cancelled' || j.deleted_at) return false;
      if (filterDriver !== 'all' && j.assigned_driver_id !== filterDriver) return false;
      if (filterCustomer !== 'all' && j.customer_id !== filterCustomer) return false;
      if (filterPickupLocation !== 'all' && j.pickup_location_id !== filterPickupLocation) return false;
      if (filterTruckType !== 'all' && j.truck_type !== filterTruckType) return false;
      return true;
    }).sort((a, b) => {
      const aOrder = a.sort_order ?? 9999;
      const bOrder = b.sort_order ?? 9999;
      return aOrder - bOrder;
    });
  };

  const canAssign = userRole === 'admin' || userRole === 'dispatcher';

  const weekLabel = () => {
    if (weekOffset === 0) return 'This Week';
    if (weekOffset === 1) return 'Next Week';
    return `${format(weekStart, 'MMM d')}–${format(addDays(weekStart, 4), 'MMM d')}`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-600 rounded-lg flex items-center justify-center">
            <Monitor className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white">Miller Sawdust – Wallboard</h1>
            <p className="text-xs text-gray-400">{weekLabel()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filters */}
          <Filter className="w-4 h-4 text-gray-400" />
          <Select value={filterDriver} onValueChange={setFilterDriver}>
            <SelectTrigger className="h-8 text-xs w-36 bg-gray-800 border-gray-600 text-gray-200">
              <SelectValue placeholder="All Drivers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Drivers</SelectItem>
              {drivers.filter(d => d.active && d.role === 'driver' && weekDriverIds.includes(d.id)).map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterCustomer} onValueChange={setFilterCustomer}>
            <SelectTrigger className="h-8 text-xs w-36 bg-gray-800 border-gray-600 text-gray-200">
              <SelectValue placeholder="All Customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.filter(c => weekCustomerIds.includes(c.id)).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}{c.company_name ? ` (${c.company_name})` : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterPickupLocation} onValueChange={setFilterPickupLocation}>
            <SelectTrigger className="h-8 text-xs w-40 bg-gray-800 border-gray-600 text-gray-200">
              <SelectValue placeholder="All Locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Pickup Locations</SelectItem>
              {pickupLocations.filter(l => weekPickupLocationIds.includes(l.id)).map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterTruckType} onValueChange={setFilterTruckType}>
            <SelectTrigger className="h-8 text-xs w-36 bg-gray-800 border-gray-600 text-gray-200">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="straight_truck">Straight Truck</SelectItem>
              <SelectItem value="semi">Semi</SelectItem>
              <SelectItem value="spreader">Spreader</SelectItem>
            </SelectContent>
          </Select>

          <div className="w-px h-5 bg-gray-600 mx-1" />
          <Button variant="ghost" size="icon" onClick={() => refetchJobs()} className="text-gray-400 hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-sm text-gray-300 font-medium min-w-[90px] text-center">{weekLabel()}</span>
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 hover:text-white">
            <ChevronRight className="w-5 h-5" />
          </Button>
          {weekOffset !== 0 && (
            <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)} className="text-xs text-gray-300 border-gray-600">
              Today
            </Button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 grid grid-cols-5 divide-x divide-gray-700 overflow-hidden">
        {weekDays.map((day, i) => {
          const dayJobs = getJobsForDay(day);
          const isCurrentDay = isToday(day);
          return (
            <div key={i} className="flex flex-col min-h-0">
              {/* Day Header */}
              <div className={cn(
                "flex items-center justify-between px-3 py-3 border-b border-gray-700 shrink-0",
                isCurrentDay ? "bg-amber-900/40" : "bg-gray-800/60"
              )}>
                <div>
                  <p className={cn("text-xs font-semibold uppercase", isCurrentDay ? "text-amber-400" : "text-gray-500")}>
                    {DAYS[i]}
                  </p>
                  <p className={cn("text-xl font-bold", isCurrentDay ? "text-amber-300" : "text-gray-200")}>
                    {format(day, 'd')}
                  </p>
                  <p className="text-[10px] text-gray-500">{format(day, 'MMM')}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {dayJobs.length > 0 && (() => {
                    const totalLoads = dayJobs.reduce((sum, j) => sum + (Number(j.quantity) || 0), 0);
                    return (
                      <Badge className="bg-gray-700 text-gray-300 text-[13px]">
                        {totalLoads} load{totalLoads !== 1 ? 's' : ''}
                      </Badge>
                    );
                  })()}
                  {canAssign && (
                    <button
                      onClick={() => setQuickJobDate(format(day, 'yyyy-MM-dd'))}
                      className="w-6 h-6 rounded-full bg-amber-700/50 hover:bg-amber-600 text-amber-200 flex items-center justify-center transition-colors"
                      title={`Add job on ${format(day, 'MMM d')}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Jobs */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {dayJobs.length === 0 ? (
                  <p className="text-xs text-gray-600 text-center pt-6">No jobs</p>
                ) : (
                  dayJobs.map(job => (
                    <WallboardJobCard
                      key={job.id}
                      job={job}
                      drivers={drivers.filter(d => d.active && d.role === 'driver')}
                      onAssign={(jobId, driverId) => assignMutation.mutate({ jobId, driverId })}
                      canAssign={canAssign}
                      onCardClick={setSelectedJob}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Job Detail Popup */}
      {selectedJob && (
        <WallboardJobDetailPopup
          job={selectedJob}
          driver={drivers.find(d => d.id === selectedJob.assigned_driver_id)}
          pickupLocations={pickupLocations}
          onClose={() => setSelectedJob(null)}
        />
      )}

      {/* Quick Job Form */}
      {quickJobDate && (
        <QuickJobForm
          date={quickJobDate}
          drivers={drivers}
          customers={customers}
          pickupLocations={pickupLocations}
          userRole={userRole}
          onSave={(data) => createJobMutation.mutate(data)}
          onClose={() => setQuickJobDate(null)}
        />
      )}
    </div>
  );
}