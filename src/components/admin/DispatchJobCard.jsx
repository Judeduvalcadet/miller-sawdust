import React from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Truck, Package, MapPin, Calendar, User, 
  Edit, Trash2, DollarSign, MoreHorizontal
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export default function DispatchJobCard({ job, driver, onEdit, onCancel }) {
  const isCompleted = job.status === 'completed';
  const isCancelled = job.status === 'cancelled';
  const isPending = job.status === 'pending';

  return (
    <Card className={cn(
      "p-4 border-l-4 transition-all",
      isPending && "border-l-gray-300 bg-gray-50/40",
      isCompleted && "border-l-green-500 bg-green-50/30",
      isCancelled && "border-l-gray-400 bg-gray-50 opacity-60"
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className={cn(
            "p-2 rounded-lg shrink-0",
            job.job_type === 'pickup' ? "bg-amber-100" : "bg-blue-100"
          )}>
            {job.job_type === 'pickup' ? (
              <Package className="w-5 h-5 text-amber-700" />
            ) : (
              <Truck className="w-5 h-5 text-blue-700" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={cn(
                "text-xs font-semibold uppercase",
                job.job_type === 'pickup' ? "text-amber-700" : "text-blue-700"
              )}>
                {job.job_type}
              </span>
              <Badge className={cn(
                "text-xs",
                isPending && "bg-gray-100 text-gray-600",
                isCompleted && "bg-green-100 text-green-700",
                isCancelled && "bg-gray-100 text-gray-600"
              )}>
                {job.status}
              </Badge>
              {job.payment_collected && (
                <Badge className="bg-green-500 text-white text-xs">
                  <DollarSign className="w-3 h-3 mr-0.5" />
                  Paid
                </Badge>
              )}
            </div>
            <h3 className="font-semibold text-gray-900">{job.location_name}</h3>
            {job.customer_company_name && (
              <p className="text-xs text-gray-500 -mt-0.5">{job.customer_company_name}</p>
            )}
            <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
              <MapPin className="w-3.5 h-3.5" />
              <span className="truncate">{job.address}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {format(new Date(job.scheduled_date + 'T00:00:00'), 'MMM d')}
              </div>
              <div className="flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                {driver?.name || 'Unassigned'}
              </div>
              <div className="font-medium">
                {job.quantity} load{job.quantity !== 1 ? 's' : ''}
              </div>
              {job.delivery_yards && (
                <div className="font-semibold text-amber-700">{job.delivery_yards} yds</div>
              )}
            </div>
            {(() => {
              if (job.truck_type === 'spreader' && Array.isArray(job.loads)) {
                const configs = job.loads.filter(l => l.load_configuration).map(l => `L${l.load_number}: ${l.load_configuration}`);
                return configs.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {configs.map((c, i) => (
                      <span key={i} className={cn(
                        "inline-block border text-xs font-medium px-2 py-0.5 rounded",
                        isCompleted ? "bg-white border-gray-200 text-gray-700" : "bg-gray-100 border-gray-200 text-gray-700"
                      )}>{c}</span>
                    ))}
                  </div>
                ) : null;
              }
              return job.load_configuration ? (
                <div className={cn(
                  "mt-1.5 inline-block border text-xs font-medium px-2 py-0.5 rounded",
                  isCompleted ? "bg-white border-gray-200 text-gray-700" : "bg-gray-100 border-gray-200 text-gray-700"
                )}>
                  {job.load_configuration}
                </div>
              ) : null;
            })()}
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(job)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </DropdownMenuItem>
            {job.status !== 'cancelled' && (
              <DropdownMenuItem 
                onClick={() => onCancel(job)}
                className="text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Cancel Job
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}