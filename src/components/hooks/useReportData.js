import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/entities';

export function useReportData() {
  const jobs = useQuery({ queryKey: ['report-jobs'], queryFn: () => base44.entities.Job.list('-scheduled_date', 5000) });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: () => base44.entities.Driver.list() });
  const customers = useQuery({ queryKey: ['report-customers'], queryFn: () => base44.entities.Customer.list(undefined, 5000) });
  const pickups = useQuery({ queryKey: ['pickupLocations'], queryFn: () => base44.entities.PickupLocation.list() });
  return { jobs: jobs.data || [], drivers: drivers.data || [], customers: customers.data || [], pickupLocations: pickups.data || [], isLoading: [jobs, drivers, customers, pickups].some(q => q.isPending) };
}
