import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/entities";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { FileText, DollarSign, Search, Truck, User } from "lucide-react";
import { cn } from "@/lib/utils";


function JobRow({ job, onMarkInvoiced, onMarkPaid, pendingJob, setPendingJob }) {
  const isPending = pendingJob === job.id;

  return (
    <div className="flex items-start justify-between py-3 px-4 hover:bg-gray-50 border-b last:border-b-0">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 shrink-0">
          <Truck className="w-4 h-4 text-blue-500" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{job.location_name}</p>
          <p className="text-xs text-gray-500 truncate">{job.address}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-gray-400">
              {format(new Date(job.scheduled_date + 'T00:00:00'), 'MMM d, yyyy')}
            </span>
            {job.assigned_driver_name && (
              <span className="text-xs text-gray-500">· {job.assigned_driver_name}</span>
            )}
            <span className="text-xs text-gray-400">· {job.quantity} load{job.quantity !== 1 ? 's' : ''}</span>
            {job.delivery_yards ? (
              <span className="text-xs font-medium text-amber-700">· {job.delivery_yards} yds</span>
            ) : null}
            {job.load_configuration && (
              <span className="text-xs text-gray-500">· {job.load_configuration}</span>
            )}
          </div>

          {job.invoice_sent === 'yes' && job.invoice_marked_by && (
            <div className="flex items-center gap-1 mt-1">
              <User className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] text-blue-500">
                Invoiced by {job.invoice_marked_by}
                {job.invoice_marked_at ? ` · ${format(new Date(job.invoice_marked_at), 'MMM d')}` : ''}
              </span>
            </div>
          )}
          {job.payment_collected && job.payment_marked_by && (
            <div className="flex items-center gap-1 mt-1">
              <User className="w-3 h-3 text-green-400" />
              <span className="text-[10px] text-green-500">
                Marked paid by {job.payment_marked_by}
                {job.payment_marked_at ? ` · ${format(new Date(job.payment_marked_at), 'MMM d')}` : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 ml-3 shrink-0">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] text-gray-400 uppercase tracking-wide">Job Status</span>
          <span className={cn(
            "text-[10px] font-semibold capitalize",
            job.status === 'completed' && "text-green-600",
            job.status === 'in_progress' && "text-yellow-600",
            job.status === 'pending' && "text-gray-500",
          )}>
            {job.status}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] text-gray-400 uppercase tracking-wide">Payment</span>
          {job.payment_collected ? (
            <span className="text-[10px] text-green-600 font-semibold flex items-center gap-0.5">
              <DollarSign className="w-3 h-3" /> Paid
            </span>
          ) : (
            <span className="text-[10px] text-gray-800 font-semibold flex items-center gap-0.5">
              <DollarSign className="w-3 h-3" /> Not Paid
            </span>
          )}
        </div>

        {onMarkInvoiced && (
          isPending ? (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="text-[10px] h-6 px-2" onClick={() => setPendingJob(null)}>Cancel</Button>
              <Button size="sm" className="text-[10px] h-6 px-2 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { onMarkInvoiced(job); setPendingJob(null); }}>Confirm</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="text-[10px] h-6 px-2 border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => setPendingJob(job.id)}>
              Mark Invoiced
            </Button>
          )
        )}
        {onMarkPaid && (
          isPending ? (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="text-[10px] h-6 px-2" onClick={() => setPendingJob(null)}>Cancel</Button>
              <Button size="sm" className="text-[10px] h-6 px-2 bg-green-600 hover:bg-green-700 text-white" onClick={() => { onMarkPaid(job); setPendingJob(null); }}>Confirm</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="text-[10px] h-6 px-2 border-green-300 text-green-700 hover:bg-green-50" onClick={() => setPendingJob(job.id)}>
              Mark Paid
            </Button>
          )
        )}
      </div>
    </div>
  );
}

function TabSection({ jobs, emptyText, onMarkInvoiced, onMarkPaid }) {
  const [pendingJob, setPendingJob] = useState(null);

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <FileText className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {jobs.map(job => (
        <JobRow
          key={job.id}
          job={job}
          onMarkInvoiced={onMarkInvoiced}
          onMarkPaid={onMarkPaid}
          pendingJob={pendingJob}
          setPendingJob={setPendingJob}
        />
      ))}
    </div>
  );
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function Invoicing() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [searchQuery, setSearchQuery] = useState('');


  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => base44.entities.Job.list('-scheduled_date', 200),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Job.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['jobs'] });
      const previousJobs = queryClient.getQueryData(['jobs']);
      queryClient.setQueryData(['jobs'], (old) =>
        old.map(job => job.id === id ? { ...job, ...data } : job)
      );
      return { previousJobs };
    },
    onError: (err, variables, context) => {
      queryClient.setQueryData(['jobs'], context.previousJobs);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const getMarkerName = () => {
    if (!currentUser) return 'Admin';
    return currentUser.full_name || currentUser.role || 'Staff';
  };

  const deliveryJobs = jobs.filter(j => {
    if (j.job_type !== 'delivery' || j.status === 'cancelled') return false;
    const d = new Date(j.scheduled_date + 'T00:00:00');
    return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
  });
  const sortOldestFirst = (a, b) => a.scheduled_date.localeCompare(b.scheduled_date);
  const query = searchQuery.toLowerCase().trim();
  const filtered = query
    ? deliveryJobs.filter(j => (j.location_name || '').toLowerCase().includes(query) || (j.address || '').toLowerCase().includes(query))
    : deliveryJobs;
  const notInvoiced = filtered.filter(j => !j.invoice_sent || j.invoice_sent === 'no').sort(sortOldestFirst);
  const invoiced = filtered.filter(j => j.invoice_sent === 'yes' && !j.payment_collected).sort(sortOldestFirst);
  const paid = filtered.filter(j => j.payment_collected).sort(sortOldestFirst);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Invoicing for {MONTHS[selectedMonth]} {selectedYear}</h1>
            <p className="text-sm text-gray-500">Track delivery job billing status</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="relative w-1/2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search customer name or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={`${selectedYear}-${selectedMonth}`}
            onValueChange={(val) => {
              const [y, m] = val.split('-');
              setSelectedYear(Number(y));
              setSelectedMonth(Number(m));
            }}
          >
            <SelectTrigger className="w-1/4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const y = d.getFullYear();
                const m = d.getMonth();
                return (
                  <SelectItem key={`${y}-${m}`} value={`${y}-${m}`}>
                    {MONTHS[m]} {y}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <Tabs defaultValue="not_invoiced">
          <TabsList className="w-full rounded-none border-b bg-gray-50 h-auto p-0">
            <TabsTrigger value="not_invoiced" className="flex-1 rounded-none py-3 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-amber-500 text-sm">
              Not Invoiced
              {notInvoiced.length > 0 && (
                <span className="ml-1.5 bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {notInvoiced.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="invoiced" className="flex-1 rounded-none py-3 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-500 text-sm">
              Invoiced
              {invoiced.length > 0 && (
                <span className="ml-1.5 bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {invoiced.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="paid" className="flex-1 rounded-none py-3 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-green-500 text-sm">
              Paid
              {paid.length > 0 && (
                <span className="ml-1.5 bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {paid.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="not_invoiced" className="m-0">
            <TabSection
              jobs={notInvoiced}
              emptyText="All delivery jobs have been invoiced"
              onMarkInvoiced={(job) => { const markerName = getMarkerName(); updateMutation.mutate({ id: job.id, data: { invoice_sent: 'yes', invoice_marked_by: markerName, invoice_marked_at: new Date().toISOString() } }); }}
            />
          </TabsContent>
          <TabsContent value="invoiced" className="m-0">
            <TabSection
              jobs={invoiced}
              emptyText="No invoices awaiting payment"
              onMarkPaid={(job) => { const markerName = getMarkerName(); updateMutation.mutate({ id: job.id, data: { payment_collected: true, payment_marked_by: markerName, payment_marked_at: new Date().toISOString() } }); }}
            />
          </TabsContent>
          <TabsContent value="paid" className="m-0">
            <TabSection
              jobs={paid}
              emptyText="No payments collected yet"
            />
          </TabsContent>
        </Tabs>
      </div>


    </div>
  );
}