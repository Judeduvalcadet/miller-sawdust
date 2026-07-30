/* global __BUILD_ID__ */
import { useEffect } from 'react';

// Saved home-screen web apps resume from memory with whatever bundle they
// loaded last — sometimes days old. This checks the deployed build id when
// the app becomes visible (and every 5 minutes, for the wallboard TV) and
// reloads once when a newer build is live.
export default function AutoUpdate() {
  useEffect(() => {
    if (typeof __BUILD_ID__ === 'undefined') return undefined;

    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        const { build } = await res.json();
        if (build && build !== __BUILD_ID__) {
          // reload at most once a minute so a bad response can't loop us
          const last = Number(sessionStorage.getItem('miller_last_reload') || 0);
          if (Date.now() - last > 60_000) {
            sessionStorage.setItem('miller_last_reload', String(Date.now()));
            window.location.reload();
          }
        }
      } catch {
        // offline or dev server (no version.json) — ignore
      } finally {
        checking = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(check, 5 * 60_000);
    check();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, []);

  return null;
}
