import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Simplified — Base44's appLogs tracking removed.
// Could be replaced with Supabase log_entries if needed later.
export default function NavigationTracker() {
    const location = useLocation();

    useEffect(() => {
        // No-op: navigation logging removed during Base44 migration
    }, [location]);

    return null;
}
