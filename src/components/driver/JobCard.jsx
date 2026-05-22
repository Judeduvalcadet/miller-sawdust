import React from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Truck, Package, MapPin, DollarSign, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

export default function JobCard({ job, onClick }) {
  const isCompleted = job.status === 'completed';
  const isCancelled = job.status === 'cancelled';
  const isPending = job.status === 'pending';
  const hasNotes = !!((job.dispatcher_notes && job.dispatcher_notes.trim()) || (job.driver_notes && job.driver_notes.trim()));

  return (
    <Card 
      onClick={onClick}
      className={cn(
        "p-4 cursor-pointer transition-all duration-200 border-l-4",
        isPending && "bg-red-50/60 border-l-red-400 hover:bg-red-50",
        isCompleted && "bg-green-50/60 border-l-green-500 hover:bg-green-50",
        isCancelled && "bg-gray-100 border-l-gray-400 opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={cn(
            "p-2 rounded-lg shrink-0",
            job.job_type === 'pickup' ? "bg-amber-100" : "bg-blue-100"
          )}>
            {job.job_type === 'pickup' ? (
              <Package className={cn("w-5 h-5", "text-amber-700")} />
            ) : (
              <Truck className={cn("w-5 h-5", "text-blue-700")} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                job.job_type === 'pickup' ? "text-amber-700" : "text-blue-700"
              )}>
                {job.job_type}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  isPending && "bg-red-100 text-red-700 border-red-300",
                  isCompleted && "bg-green-100 text-green-700 border-green-300",
                  isCancelled && "bg-gray-100 text-gray-600 border-gray-300"
                )}
              >
                {job.status}
              </Badge>
              {hasNotes && (
                <span className="inline-flex items-center gap-0.5 bg-black text-white text-xs px-2 py-0.5 rounded font-semibold">
                  <StickyNote className="w-3 h-3" />
                  NOTE
                </span>
              )}
            </div>
            <h3 className="font-semibold text-gray-900 mt-1 truncate">
              {job.location_name}
            </h3>
            <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
              <MapPin className="w-3.5 h-3.5" />
              <span className="truncate">{job.address}</span>
            </div>
            {(() => {
              if (Array.isArray(job.loads) && job.loads.length > 0) {
                const configs = job.loads.filter(l => l.load_configuration).map(l => `L${l.load_number}: ${l.load_configuration}`);
                return configs.length > 0 ? (
                  <p className="text-xs text-amber-700 mt-1 truncate">{configs.join(' | ')}</p>
                ) : null;
              }
              return job.load_configuration ? (
                <p className="text-xs text-amber-700 mt-1 truncate">{job.load_configuration}</p>
              ) : null;
            })()}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-gray-900">
            {job.quantity} <span className="text-sm font-normal text-gray-500">load{job.quantity !== 1 ? 's' : ''}</span>
          </div>
          {job.payment_collected && (
            <Badge className="bg-green-500 text-white mt-1">
              <DollarSign className="w-3 h-3 mr-0.5" />
              Paid
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}