import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/entities';

/**
 * Hook to subscribe to real-time entity updates and invalidate React Query cache
 * @param {string} entityName - Name of the entity to subscribe to
 * @param {string} queryKey - Query key to invalidate on updates
 */
export function useEntitySubscription(entityName, queryKey) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = base44.entities[entityName].subscribe((event) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    });

    return unsubscribe;
  }, [entityName, queryKey, queryClient]);
}