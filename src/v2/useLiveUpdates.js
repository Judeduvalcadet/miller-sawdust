import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { entityQueryKeys, notifyEntityChange, refreshEntityQueries, subscribeEntityChanges } from '@/lib/entityChanges';

export function useLiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    const pending = new Set();
    let timer;
    const unsubscribe = subscribeEntityChanges(table => {
      pending.add(table);
      // Coalesce bursts from imports and repeated notifications into one refresh.
      clearTimeout(timer);
      timer = setTimeout(() => {
        const keys = new Set([...pending].flatMap(table => entityQueryKeys[table] || []));
        pending.clear();
        void client.invalidateQueries({ predicate: q => keys.has(q.queryKey[0]) });
      }, 50);
    });
    let channel = supabase.channel('v2-live-data');
    for (const table of Object.keys(entityQueryKeys)) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => notifyEntityChange(table));
    }
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshEntityQueries(client);
    };
    channel.subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
    // Recover missed events after sleep, reconnects, or unavailable replication.
    const fallback = setInterval(refresh, 30000);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      clearInterval(fallback);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      void supabase.removeChannel(channel);
    };
  }, [client]);
}
