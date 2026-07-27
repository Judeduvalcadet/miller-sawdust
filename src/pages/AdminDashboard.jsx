import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  Plus, Truck, RefreshCw, Wifi, WifiOff
} from "lucide-react";
import { isToday } from "date-fns";
import JobForm from "@/components/admin/JobForm";
import GlobalSearch from "@/components/admin/GlobalSearch";
import MiniWallboard from "@/components/admin/MiniWallboard";
import SortJobsModal from "@/components/admin/SortJobsModal.jsx";
import { useActivityDetection } from "@/components/hooks/useActivityDetection";
import { useEntitySubscription } from "@/components/hooks/useEntitySubscription";

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const [showJobForm, setShowJobForm] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [defaultJobDate, setDefaultJobDate] = useState(null);
  const [showSortModal, setShowSortModal] = useState(false);
  const [sortDate, setSortDate] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const isActive = useActivityDetection(120000); // 2 minute idle timeout for admin

  // Real-time subscriptions
  useEntitySubscription('Job', 'jobs');
  useEntitySubscription('Driver', 'drivers');
  useEntitySubscription('Customer', 'customers');
  useEntitySubscription('PickupLocation', 'pickupLocations');
  useEntitySubscription('DropOffLocation', 'dropOffLocations');

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => base44.entities.Job.list('-scheduled_date', 5000),
    refetchOnWindowFocus: true,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => base44.entities.Driver.list(),
    refetchOnWindowFocus: true,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list(undefined, 5000),
    refetchOnWindowFocus: true,
  });

  const { data: pickupLocations = [] } = useQuery({
    queryKey: ['pickupLocations'],
    queryFn: () => base44.entities.PickupLocation.list('name'),
    refetchOnWindowFocus: true,
  });

  const { data: dropOffLocations = [] } = useQuery({
    queryKey: ['dropOffLocations'],
    queryFn: () => base44.entities.DropOffLocation.list('name'),
    refetchOnWindowFocus: true,
  });

  const createJobMutation = useMutation({
    mutationFn: (data) => base44.entities.Job.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setShowJobForm(false);
    }
  });

  const updateJobMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Job.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setShowJobForm(false);
      setEditingJob(null);
    }
  });

  const handleCreateJob = (data) => {
    createJobMutation.mutate(data);
  };

  const handleUpdateJob = (data) => {
    updateJobMutation.mutate({ id: editingJob.id, data });
  };

  const handleCancelJob = async (job) => {
    if (confirm('Are you sure you want to cancel this job?')) {
      await base44.entities.Job.update(job.id, { status: 'cancelled' });
      refetchJobs();
    }
  };

  const handleEditJob = (job) => {
    setEditingJob(job);
    setShowJobForm(true);
  };

  const handleDeleteJob = async () => {
    const jobIdToDelete = editingJob.id;
    queryClient.setQueryData(['jobs'], (oldJobs) =>
      (oldJobs ?? []).filter((job) => job.id !== jobIdToDelete)
    );
    setShowJobForm(false);
    setEditingJob(null);
    try {
      await base44.entities.Job.delete(jobIdToDelete);
    } catch {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    }
  };

  const pendingCount = jobs.filter(j => j.status === 'pending').length;
  const todayCount = jobs.filter(j => isToday(new Date(j.scheduled_date + 'T00:00:00'))).length;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col lg:h-screen lg:overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b shrink-0 z-20">
        <div className="px-4 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center">
                <Truck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-xl text-gray-900">Miller Sawdust</h1>
                <p className="text-sm text-gray-500">Dispatch Board</p>
              </div>
            </div>
            <div className="flex-1 md:max-w-xl md:mx-4">
              <GlobalSearch />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg text-xs text-gray-600">
                {isSyncing ? (
                  <>
                    <Wifi className="w-4 h-4 animate-pulse text-amber-600" />
                    <span>Syncing...</span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>Live</span>
                  </>
                )}
              </div>
              <Button variant="outline" size="icon" onClick={() => refetchJobs()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button 
                onClick={() => {
                  setEditingJob(null);
                  setShowJobForm(true);
                }}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Job
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col px-4 py-4 lg:min-h-0">

        {/* Mini Wallboard */}
        <MiniWallboard
          jobs={jobs}
          drivers={drivers}
          pickupLocations={pickupLocations}
          isAdmin={true}
          onAddJob={(date) => {
            setEditingJob(null);
            setDefaultJobDate(date);
            setShowJobForm(true);
          }}
          onEditJob={handleEditJob}
          onSortJobs={(date) => {
            setSortDate(date);
            setShowSortModal(true);
          }}
        />
      </div>

      {/* Sort Jobs Modal */}
      <SortJobsModal
        open={showSortModal}
        onClose={() => {
          setShowSortModal(false);
          setSortDate(null);
        }}
        jobs={jobs}
        drivers={drivers}
        preSelectedDate={sortDate}
      />

      {/* Job Form Dialog */}
      <Dialog open={showJobForm} onOpenChange={setShowJobForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <JobForm
            job={editingJob || (defaultJobDate ? { scheduled_date: defaultJobDate } : null)}
            drivers={drivers}
            customers={customers}
            pickupLocations={pickupLocations}
            dropOffLocations={dropOffLocations}
            onSubmit={editingJob ? handleUpdateJob : handleCreateJob}
            onDelete={editingJob ? handleDeleteJob : undefined}
            onCancel={() => {
              setShowJobForm(false);
              setEditingJob(null);
              setDefaultJobDate(null);
            }}
            isLoading={createJobMutation.isPending || updateJobMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}