import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/entities';
import { Bell, X } from 'lucide-react';

export default function NotificationBell({ driverId }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!driverId) return;
    loadNotifications();
  }, [driverId]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadNotifications = async () => {
    try {
      const all = await base44.entities.DriverNotification.filter({
        driver_id: driverId,
        read: false
      });
      setNotifications(all);
    } catch (e) {
      console.error('Failed to load notifications:', e);
    }
  };

  const dismiss = async (notif) => {
    try {
      await base44.entities.DriverNotification.update(notif.id, { read: true });
      setNotifications(prev => prev.filter(n => n.id !== notif.id));
    } catch (e) {
      console.error('Failed to dismiss notification:', e);
    }
  };

  const dismissAll = async () => {
    try {
      for (const n of notifications) {
        await base44.entities.DriverNotification.update(n.id, { read: true });
      }
      setNotifications([]);
      setOpen(false);
    } catch (e) {
      console.error('Failed to dismiss all:', e);
    }
  };

  const count = notifications.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-white hover:bg-white/20 transition-colors"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            {count > 0 && (
              <button
                onClick={dismissAll}
                className="text-xs text-amber-600 font-medium hover:text-amber-700"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {count === 0 ? (
              <div className="py-8 text-center">
                <Bell className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No new notifications</p>
              </div>
            ) : (
              notifications.map(notif => (
                <div
                  key={notif.id}
                  className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50"
                >
                  <div className="w-2 h-2 bg-amber-500 rounded-full mt-1.5 shrink-0" />
                  <p className="flex-1 text-sm text-gray-700">{notif.message}</p>
                  <button
                    onClick={() => dismiss(notif)}
                    className="text-gray-400 hover:text-gray-600 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
