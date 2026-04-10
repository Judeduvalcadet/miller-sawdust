import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/entities';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, LogOut, RefreshCw, Truck, Wifi, CalendarDays, X } from "lucide-react";
import { format, isToday, isTomorrow, startOfWeek, endOfWeek, isWithinInterval, isSameDay } from "date-fns";
import { createPageUrl } from "@/utils";
import JobCard from "@/components/driver/JobCard";
import JobDetail from "@/components/driver/JobDetail";
import NotificationBell from "@/components/driver/NotificationBanner";
import { useActivityDetection } from "@/components/hooks/useActivityDetection";
import CalendarPicker from "@/components/driver/CalendarPicker";

export default function DriverDashboard() {
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [activeTab, setActiveTab] = useState('today');
  const [driverName, setDriverName] = useState('');
  const [driverId, setDriverId] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  
  const isActive = useActivityDetection(60000); // 1 minute idle timeout for driver

  useEffect(() => {
    const storedDriverId = localStorage.getItem('miller_driver_id');
    const storedDriverName = localStorage.getItem('miller_driver_name');
    
    if (!storedDriverId) {
      window.location.href = createPageUrl('DriverLogin');
      return;
    }
    
    setDriverId(storedDriverId);
    setDriverName(storedDriverName || 'Driver');
    loadJobs(storedDriverId);

    // Real-time subscription for Job updates
    const unsubscribe = base44.entities.Job.subscribe(() => {
      loadJobs(storedDriverId);
    });

    // Auto-refresh based on activity: 2 sec when idle, 30 sec when active
    const intervalId = setInterval(() => {
      loadJobs(storedDriverId);
    }, isActive ? 30000 : 2000);

    // Refresh when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadJobs(storedDriverId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribe();
    };
  }, [isActive]);

  const [pickupLocations, setPickupLocations] = useState([]);
  const [customers, setCustomers] = useState([]);

  const loadJobs = async (id) => {
    try {
      const [driverJobs, locs, custs] = await Promise.all([
        base44.entities.Job.filter({ assigned_driver_id: id || driverId }, '-scheduled_date', 5000),
        base44.entities.PickupLocation.list(),
        base44.entities.Customer.list(undefined, 5000)
      ]);
      setJobs(driverJobs);
      setPickupLocations(locs);
      setCustomers(custs);
    } catch (e) {
      console.error('Failed to load jobs:', e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadJobs(driverId);
  };

  const handleLogout = () => {
    localStorage.removeItem('miller_session_id');
    localStorage.removeItem('miller_driver_id');
    localStorage.removeItem('miller_driver_name');
    window.location.href = createPageUrl('DriverLogin');
  };

  const handleUpdateJob = async (updates) => {
    setIsUpdating(true);
    try {
      await base44.entities.Job.update(selectedJob.id, updates);
      setSelectedJob({ ...selectedJob, ...updates });
      loadJobs(driverId);
    } catch (e) {
      console.error('Failed to update job:', e);
    } finally {
      setIsUpdating(false);
    }
  };

  const filterJobs = (tab) => {
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

    return jobs.filter(job => {
      if (job.status === 'cancelled') return false;
      const jobDate = new Date(job.scheduled_date + 'T00:00:00');
      
      switch (tab) {
        case 'today':
          return isToday(jobDate);
        case 'tomorrow':
          return isTomorrow(jobDate);
        case 'week':
          return isWithinInterval(jobDate, { start: weekStart, end: weekEnd }) && 
                 !isToday(jobDate) && !isTomorrow(jobDate);
        default:
          return true;
      }
    }).sort((a, b) => {
      // Always respect sort_order when set (matches wallboard)
      if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
      if (a.sort_order != null) return -1;
      if (b.sort_order != null) return 1;
      // Fallback: pending first, then by date
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(a.scheduled_date + 'T00:00:00') - new Date(b.scheduled_date + 'T00:00:00');
    });
  };

  if (selectedJob) {
    return (
      <JobDetail
        job={selectedJob}
        onBack={() => {
          setSelectedJob(null);
          loadJobs(driverId);
        }}
        onUpdate={handleUpdateJob}
        isUpdating={isUpdating}
        pickupLocations={pickupLocations}
        driverName={driverName}
        customer={customers.find(c => c.id === selectedJob.customer_id) || null}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  const calendarDayJobs = selectedCalendarDate
    ? jobs.filter(j => j.status !== 'cancelled' && isSameDay(new Date(j.scheduled_date + 'T00:00:00'), selectedCalendarDate))
          .sort((a, b) => {
            if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
            if (a.sort_order != null) return -1;
            if (b.sort_order != null) return 1;
            return 0;
          })
    : [];

  const filteredJobs = selectedCalendarDate ? calendarDayJobs : filterJobs(activeTab);
  const todayCount = filterJobs('today').length;
  const tomorrowCount = filterJobs('tomorrow').length;
  const weekCount = filterJobs('week').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-amber-600 text-white px-4 py-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-amber-100 text-sm">Welcome back</p>
              <h1 className="font-bold text-lg">{driverName}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSyncing && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white/20 rounded text-xs text-white">
                <Wifi className="w-3.5 h-3.5 animate-pulse" />
                <span>Syncing</span>
              </div>
            )}
            <NotificationBell driverId={driverId} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowCalendar(true)}
              className="text-white hover:bg-white/20"
            >
              <CalendarDays className="w-5 h-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={handleRefresh}
              className="text-white hover:bg-white/20"
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={handleLogout}
              className="text-white hover:bg-white/20"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-0 bg-white border-b z-10 px-4 py-3">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="today" className="relative">
              Today
              {todayCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                  {todayCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="tomorrow">
              Tomorrow
              {tomorrowCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                  {tomorrowCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="week">
              This Week
              {weekCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                  {weekCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Selected calendar date banner */}
      {selectedCalendarDate && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 border-b border-amber-200">
          <span className="text-sm font-semibold text-amber-800">
            📅 {format(selectedCalendarDate, 'EEEE, MMMM d')}
          </span>
          <button
            onClick={() => setSelectedCalendarDate(null)}
            className="flex items-center gap-1 text-xs text-amber-600 font-medium"
          >
            <X className="w-3.5 h-3.5" />
            Back to schedule
          </button>
        </div>
      )}

      {/* Jobs List */}
      <div className="p-4 space-y-3">
        {filteredJobs.length === 0 ? (
          <div className="text-center py-12">
            <Truck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No jobs scheduled</p>
            <p className="text-gray-400 text-sm mt-1">
              {selectedCalendarDate
                ? `for ${format(selectedCalendarDate, 'MMMM d')}`
                : activeTab === 'today' ? 'for today'
                : activeTab === 'tomorrow' ? 'for tomorrow'
                : 'this week'}
            </p>
          </div>
        ) : (
          filteredJobs.map(job => (
            <JobCard 
              key={job.id} 
              job={job} 
              onClick={() => setSelectedJob(job)} 
            />
          ))
        )}
      </div>

      {/* Install Prompt */}
      <div className="px-4 py-8 text-center">
        <p className="text-xs text-gray-400">
          📱 Tip: Add this app to your home screen for quick access
        </p>
      </div>

      {/* Calendar Picker */}
      {showCalendar && (
        <CalendarPicker
          jobs={jobs}
          onSelectDate={(date) => {
            setSelectedCalendarDate(date);
            setShowCalendar(false);
          }}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </div>
  );
}