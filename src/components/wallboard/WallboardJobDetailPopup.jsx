import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Package, Truck, MapPin, User, Calendar, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";

const TRUCK_LABELS = { straight_truck: 'Straight', semi: 'Semi', spreader: 'Spreader' };

export default function WallboardJobDetailPopup({ job, driver, pickupLocations = [], onClose }) {
  const hasPerLoadData = job.job_type === 'delivery' && Array.isArray(job.loads) && job.loads.length > 0;
  const perLoadDetails = hasPerLoadData
    ? job.loads.filter((l) => l.pickup_location_name || l.yards_collected)
    : [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-gray-900 text-white border-gray-700">
        <DialogHeader className="border-b border-gray-700 pb-3">
          <DialogTitle className="flex items-center gap-2 text-white">
            {job.job_type === 'pickup'
              ? <Package className="w-5 h-5 text-amber-500" />
              : <Truck className="w-5 h-5 text-blue-400" />
            }
            {job.job_type === 'pickup' ? 'Pickup Job Details' : 'Delivery Job Details'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Status + Truck */}
          <div className="flex items-center justify-between">
            <Badge className={cn(
              job.status === 'completed' && "bg-green-500/30 text-green-300 border-green-600/30",
              job.status === 'pending' && "bg-gray-500/30 text-gray-300 border-gray-600/30",
              job.status === 'in_progress' && "bg-yellow-500/30 text-yellow-300 border-yellow-600/30",
              job.status === 'cancelled' && "bg-gray-700 text-gray-400"
            )}>
              {job.status === 'in_progress' ? 'In Progress' : job.status.charAt(0).toUpperCase() + job.status.slice(1)}
            </Badge>
            {job.truck_type && (
              <span className="text-xs text-gray-400">{TRUCK_LABELS[job.truck_type] || job.truck_type}</span>
            )}
          </div>

          <div className="space-y-2.5 text-sm">
            {/* Location */}
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">{job.job_type === 'pickup' ? 'Pickup Location' : 'Location'}</p>
                <p className="font-semibold text-white">{job.location_name}</p>
                {job.customer_company_name && (
                  <p className="text-xs text-gray-400">{job.customer_company_name}</p>
                )}
                {job.address && <p className="text-gray-400 text-xs">{job.address}</p>}
              </div>
            </div>

            {/* Drop-off (pickup jobs) */}
            {job.job_type === 'pickup' && job.dropoff_location_name && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Drop-Off Location</p>
                  <p className="font-semibold text-white">{job.dropoff_location_name}</p>
                </div>
              </div>
            )}

            {/* Pickup Location */}
            {job.pickup_location_id && (() => {
              const loc = pickupLocations.find(l => l.id === job.pickup_location_id);
              return loc ? (
                <div className="flex items-start gap-2">
                  <Warehouse className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-500">Pickup Location</p>
                    <p className="font-semibold text-white">{loc.name}</p>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Date */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500" />
              <span className="text-gray-300">
                {format(new Date(job.scheduled_date + 'T00:00:00'), 'EEEE, MMM d')}
              </span>
            </div>

            {/* Driver */}
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-gray-500" />
              <span className={driver ? "text-amber-300" : "italic text-gray-500"}>
                {driver?.name || 'Unassigned'}
              </span>
            </div>

            {/* Loads */}
            <div className="text-gray-300">
              <span className="font-medium">{job.quantity} load{job.quantity !== 1 ? 's' : ''}</span>
            </div>

            {/* Load Configuration */}
            {job.load_configuration && (
              <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500 mb-0.5">Load Configuration</p>
                <p className="text-sm text-gray-200">{job.load_configuration}</p>
              </div>
            )}

            {/* Dispatcher Notes */}
            {job.dispatcher_notes && (
              <div className="bg-gray-800 border border-amber-700/40 rounded-lg p-3">
                <p className="text-xs text-amber-400 font-medium mb-1">Notes</p>
                <p className="text-sm text-gray-200">{job.dispatcher_notes}</p>
              </div>
            )}

            {/* Josh per-load pickup details */}
            {perLoadDetails.length > 0 && (
              <div className="border border-blue-900/50 rounded-lg overflow-hidden">
                <div className="bg-blue-900/30 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Load Pickup Details</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-blue-900/50">
                      <th className="text-left px-3 py-1.5 text-gray-400 font-medium">Load</th>
                      <th className="text-left px-3 py-1.5 text-gray-400 font-medium">Pickup Location</th>
                      <th className="text-right px-3 py-1.5 text-gray-400 font-medium">Yards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perLoadDetails.map((l, idx) => (
                      <tr key={l.load_number} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/60'}>
                        <td className="px-3 py-2 font-medium text-gray-300">Load {l.load_number}</td>
                        <td className="px-3 py-2 text-gray-300">{l.pickup_location_name || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-300">
                          {l.yards_collected ? `${l.yards_collected} yds` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}