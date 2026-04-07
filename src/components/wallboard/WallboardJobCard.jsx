import React, { useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Truck, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const TRUCK_LABELS = {
  straight_truck: 'Straight',
  semi: 'Semi',
  spreader: 'Spreader'
};

const TRUCK_COLORS = {
  straight_truck: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  semi: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  spreader: 'bg-orange-500/20 text-orange-300 border-orange-500/30'
};

export default function WallboardJobCard({ job, drivers, onAssign, canAssign, onCardClick }) {
  const [showAssign, setShowAssign] = useState(false);

  const qty = job.quantity ?? 0;
  const quantityLabel = job.job_type === 'pickup'
    ? `${job.yards_collected ?? qty} yds`
    : (job.load_configuration || `${qty} load${qty !== 1 ? 's' : ''}`);

  return (
    <div onClick={() => onCardClick && onCardClick(job)} className={cn(
      "rounded-md p-2 text-xs border cursor-pointer select-none hover:border-gray-400/70 transition-colors",
      job.status === 'pending' && "bg-gray-800/60 border-gray-600/50",
      job.status === 'completed' && "bg-green-950/60 border-green-700/50"
    )}>
      {/* Type + Truck type + Status */}
      <div className="flex items-center gap-1 mb-1">
        {job.job_type === 'pickup' ? (
          <Package className="w-3 h-3 text-amber-400 shrink-0" />
        ) : (
          <Truck className="w-3 h-3 text-blue-400 shrink-0" />
        )}
        <span className={cn(
          "font-semibold uppercase text-[10px]",
          job.job_type === 'pickup' ? "text-amber-400" : "text-blue-400"
        )}>
          {job.job_type}
        </span>
        {job.truck_type && (
          <span className={cn(
            "text-[10px] px-1 rounded border",
            TRUCK_COLORS[job.truck_type]
          )}>
            {TRUCK_LABELS[job.truck_type]}
          </span>
        )}
        <span className={cn(
          "ml-auto text-[9px] px-1 py-0.5 rounded font-medium",
          job.status === 'pending' && "bg-gray-500/30 text-gray-300",
          job.status === 'in_progress' && "bg-yellow-500/30 text-yellow-300",
          job.status === 'completed' && "bg-green-500/30 text-green-300"
        )}>
          {job.status === 'in_progress' ? 'in progress' : job.status}
        </span>
      </div>

      {/* Location */}
      <p className="font-semibold text-white truncate text-[11px]" title={job.location_name}>
        {job.location_name}
      </p>
      {job.customer_company_name && (
        <p className="text-[9px] text-gray-400 truncate -mt-0.5">{job.customer_company_name}</p>
      )}

      {/* Driver + Quantity + Config — 2 column layout */}
      <div className="flex items-start gap-1 mt-0">
        {/* Left: driver */}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-[10px]",
            job.assigned_driver_name ? "text-amber-300" : "italic text-gray-500"
          )}>
            {job.assigned_driver_name || 'Unassigned'}
          </p>
        </div>
        {/* Right: quantity + config */}
        <div className="shrink-0 flex flex-col items-end text-right">
          <span className="text-[11px] text-gray-400 leading-tight">{quantityLabel}</span>
          {(() => {
            let label = null;
            if (Array.isArray(job.loads) && job.loads.length > 0) {
              const configs = job.loads.filter(l => l.load_configuration).map(l => `L${l.load_number}: ${l.load_configuration}`);
              if (configs.length > 0) label = configs.join(' | ');
            } else if (job.load_configuration) {
              label = job.load_configuration;
            }
            return label ? (
              <span className="text-[10px] text-gray-500 leading-tight" title={label}>{label}</span>
            ) : null;
          })()}
        </div>
      </div>

      {/* Assign button/dropdown */}
      {canAssign && (
        <div className="mt-1.5 border-t border-gray-700/50 pt-1.5">
          {!showAssign ? (
            <button
              onMouseDown={(e) => { e.stopPropagation(); setShowAssign(true); }}
              className="text-[10px] text-gray-500 hover:text-amber-400 flex items-center gap-0.5 transition-colors"
            >
              <ChevronDown className="w-2.5 h-2.5" />
              Assign to driver
            </button>
          ) : (
            <Select
              value={job.assigned_driver_id || 'unassigned'}
              onValueChange={(v) => {
                onAssign(job.id, v === 'unassigned' ? '' : v);
                setShowAssign(false);
              }}
            >
              <SelectTrigger className="h-6 text-[10px] bg-gray-800 border-gray-600 w-full">
                <SelectValue placeholder="Assign to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {drivers.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}