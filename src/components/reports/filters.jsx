import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronDown, Check, Search, X } from "lucide-react";

// ─── Filter Dropdown (button + popover with search) ──────────────────────
// Pass `availableValues` (a Set of values) to gray out options that have
// no data in the current filtered set. If omitted, all options are treated
// as available.
export function FilterDropdown({
  icon: Icon,
  label,
  options,
  selected,
  onChange,
  searchable = true,
  availableValues = null,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const count = selected.size;
  const active = count > 0;
  const visible = options.filter(o =>
    !search.trim() || o.label.toLowerCase().includes(search.toLowerCase().trim())
  );
  const showSearch = searchable && options.length > 6;

  const toggle = (val) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors",
            open
              ? "bg-amber-100 border-amber-400 text-amber-900"
              : active
                ? "bg-amber-50 border-amber-300 text-amber-800"
                : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          <span>{label}</span>
          {count > 0 && (
            <span className="text-xs bg-amber-600 text-white rounded-full px-1.5 py-0.5 font-semibold">
              {count}
            </span>
          )}
          <ChevronDown className={cn(
            "w-3.5 h-3.5 opacity-50 transition-transform",
            open && "rotate-180"
          )} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Select {label}</p>
          {count > 0 && (
            <button
              onClick={() => onChange(new Set())}
              className="text-xs text-amber-700 hover:underline font-medium"
            >
              Clear {count}
            </button>
          )}
        </div>
        {showSearch && (
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
        )}
        <div className="max-h-64 overflow-y-auto py-1">
          {visible.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No matches</p>
          ) : visible.map(o => {
            const isSel = selected.has(o.value);
            const isUnavailable = availableValues && !availableValues.has(o.value) && !isSel;
            return (
              <button
                key={o.value}
                onClick={() => toggle(o.value)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-100",
                  isSel && "bg-amber-50",
                  isUnavailable && "opacity-50"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                  isSel ? "bg-amber-600 border-amber-600" : "border-gray-300"
                )}>
                  {isSel && <Check className="w-3 h-3 text-white" />}
                </div>
                <span className={cn("truncate flex-1", isUnavailable && "text-gray-400 italic")}>
                  {o.label}
                </span>
                {isUnavailable && (
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">
                    no data
                  </span>
                )}
                {!isUnavailable && o.hint && (
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">
                    {o.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Active Filter Chip ───────────────────────────────────────────────────
export function ActiveChip({ icon: Icon, label, value, onRemove, color = "amber" }) {
  const palette = {
    amber: "bg-amber-100 text-amber-900 border-amber-300",
    blue:  "bg-blue-100  text-blue-900  border-blue-300",
    gray:  "bg-gray-100  text-gray-900  border-gray-300",
  }[color];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border text-sm",
      palette
    )}>
      <Icon className="w-3.5 h-3.5" />
      <span className="font-medium">{label}:</span>
      <span className="font-semibold max-w-[260px] truncate">{value}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 w-5 h-5 rounded-full flex items-center justify-center hover:bg-white/60 transition-colors"
          title={`Clear ${label}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

// ─── URL filter encoding / decoding ───────────────────────────────────────
// Filters are encoded as comma-separated lists per key.
// Empty sets are omitted from the URL entirely.

export const FILTER_URL_KEYS = ['drivers', 'customers', 'pickupLocs', 'jobTypes', 'truckTypes'];

export function encodeFilterParams(filters) {
  // filters: { drivers: Set, customers: Set, pickupLocs: Set, jobTypes: Set, truckTypes: Set }
  const parts = [];
  for (const k of FILTER_URL_KEYS) {
    const s = filters[k];
    if (s && s.size > 0) {
      parts.push(`${k}=${encodeURIComponent([...s].join(','))}`);
    }
  }
  return parts.join('&');
}

export function decodeFilterParams(urlParams) {
  const out = {};
  for (const k of FILTER_URL_KEYS) {
    const v = urlParams.get(k);
    out[k] = v ? new Set(v.split(',').filter(Boolean)) : new Set();
  }
  return out;
}
