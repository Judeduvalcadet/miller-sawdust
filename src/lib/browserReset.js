// Bump only for a deliberate one-time site reset, never for routine builds.
export const RESET_VERSION = 'domain-move-2026-10-02';
export const RESET_KEY = 'miller_browser_reset';
const TARGET_HOST = 'millersawdust.app';

export async function resetBrowserOnce(browser = window) {
  if (browser.location.hostname !== TARGET_HOST) return false;
  try {
    if (browser.localStorage.getItem(RESET_KEY) === RESET_VERSION) return false;
  } catch {
    // A URL marker prevents a redirect loop when storage is unavailable.
    if (new URL(browser.location.href).searchParams.get('siteReset') === RESET_VERSION) return false;
  }

  // Clear credentials before importing any code that could silently renew them.
  browser.localStorage.clear();
  browser.sessionStorage.clear();
  const bestEffort = async (operation) => {
    try { await operation(); } catch { /* Optional browser APIs may be denied. */ }
  };
  await Promise.all([
    bestEffort(async () => {
      const registrations = await browser.navigator.serviceWorker?.getRegistrations() || [];
      await Promise.all(registrations.map((r) => r.unregister()));
    }),
    bestEffort(async () => {
      const names = await browser.caches?.keys() || [];
      await Promise.all(names.map((name) => browser.caches.delete(name)));
    }),
    bestEffort(async () => {
      const databases = await browser.indexedDB?.databases?.() || [];
      await Promise.all(databases.filter((db) => db.name).map((db) => new Promise((resolve) => {
        const request = browser.indexedDB.deleteDatabase(db.name);
        request.onsuccess = request.onerror = request.onblocked = resolve;
      })));
    }),
    bestEffort(() => browser.fetch(`/browser-reset.json?v=${RESET_VERSION}`, {
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    })),
  ]);
  browser.localStorage.setItem(RESET_KEY, RESET_VERSION);
  // Fresh document, no old in-memory auth state or service-worker controller.
  browser.location.replace(`/DriverLogin?siteReset=${RESET_VERSION}`);
  return true;
}
