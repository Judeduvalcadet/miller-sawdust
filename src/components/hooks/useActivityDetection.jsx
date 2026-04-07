import { useEffect, useRef, useState } from 'react';

/**
 * Hook to detect user activity and manage idle/active state
 * @param {number} idleTimeout - Time in ms before user is considered idle (default: 2 minutes)
 * @returns {boolean} - true if user is active, false if idle
 */
export function useActivityDetection(idleTimeout = 120000) {
  const [isActive, setIsActive] = useState(true);
  const timeoutRef = useRef(null);

  useEffect(() => {
    const resetIdleTimer = () => {
      setIsActive(true);
      
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      
      timeoutRef.current = setTimeout(() => {
        setIsActive(false);
      }, idleTimeout);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    
    events.forEach(event => {
      document.addEventListener(event, resetIdleTimer, true);
    });

    resetIdleTimer();

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, resetIdleTimer, true);
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [idleTimeout]);

  return isActive;
}