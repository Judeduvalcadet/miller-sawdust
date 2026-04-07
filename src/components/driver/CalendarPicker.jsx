import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function CalendarPicker({ jobs, onSelectDate, onClose }) {
  const [viewMonth, setViewMonth] = useState(new Date());

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Days with jobs (non-cancelled)
  const jobDates = new Set(
    jobs
      .filter(j => j.status !== 'cancelled')
      .map(j => j.scheduled_date)
  );

  // Leading empty cells so the grid starts on the correct weekday
  const leadingBlanks = Array(getDay(monthStart)).fill(null);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      {/* Sheet */}
      <div
        className="w-full max-w-md bg-white rounded-t-3xl shadow-2xl pb-10 animate-in slide-in-from-bottom duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Month navigation */}
        <div className="flex items-center justify-between px-6 pt-3 pb-4">
          <button
            onClick={() => setViewMonth(subMonths(viewMonth, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <span className="text-base font-semibold text-gray-900 tracking-tight">
            {format(viewMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Day-of-week labels */}
        <div className="grid grid-cols-7 px-4 mb-1">
          {DAY_LABELS.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 px-4 gap-y-1">
          {leadingBlanks.map((_, i) => <div key={`blank-${i}`} />)}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const hasJobs = jobDates.has(dateStr);
            const today = isToday(day);

            return (
              <button
                key={dateStr}
                onClick={() => onSelectDate(day)}
                className={cn(
                  "relative flex flex-col items-center justify-center h-11 w-full rounded-xl transition-all active:scale-95",
                  today
                    ? "bg-amber-500 text-white font-bold shadow-sm"
                    : "hover:bg-gray-100 text-gray-800"
                )}
              >
                <span className={cn("text-sm", today ? "text-white" : "text-gray-900")}>
                  {format(day, 'd')}
                </span>
                {hasJobs && (
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full mt-0.5",
                    today ? "bg-white/80" : "bg-amber-500"
                  )} />
                )}
              </button>
            );
          })}
        </div>

        {/* Close button */}
        <div className="flex justify-center mt-5 px-6">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-gray-100 text-gray-700 font-semibold text-sm active:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}