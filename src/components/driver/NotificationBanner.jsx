import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/entities';
import { Bell, X } from 'lucide-react';

export default function NotificationBanner({ driverId }) {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!driverId) return;
    loadNotifications();
  }, [driverId]);

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

  if (notifications.length === 0) return null;

  return (
    <div className="space-y-2 px-4 pt-3">
      {notifications.map(notif => (
        <div
          key={notif.id}
          className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3"
        >
          <Bell className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="flex-1 text-sm text-amber-900">{notif.message}</p>
          <button onClick={() => dismiss(notif)} className="text-amber-500 hover:text-amber-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}