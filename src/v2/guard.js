// THE FREEZE (2026-09-24): production is read-only for all V2 work.
// V2 may only write when the app runs against the local sandbox database
// (started with `npm run dev -- --mode sandbox`). Every V2 mutation calls
// assertV2Writable() first, so a live-connected build (dev site, plain
// `npm run dev`) can browse everything but change nothing.

export const V2_READ_ONLY = import.meta.env.MODE !== 'sandbox';

export function assertV2Writable() {
  if (V2_READ_ONLY) {
    throw new Error('V2 is read-only against the live database — use the sandbox (localhost:5174) to make changes.');
  }
}

// One choke point instead of guards sprinkled through every component:
// on a live-connected build, every entity write attempted from a /v2 route
// throws. V1 routes (the dispatch board etc.) keep full write access —
// dispatching IS production's job; the freeze is about V2 features only.
export function installV2LiveGuard(base44) {
  if (!V2_READ_ONLY) return;
  for (const entity of Object.values(base44.entities)) {
    for (const method of ['create', 'update', 'delete', 'bulkCreate']) {
      const original = entity[method];
      if (typeof original !== 'function') continue;
      entity[method] = (...args) => {
        if (window.location.pathname.startsWith('/v2')) {
          const msg = 'Read-only: this build is connected to the LIVE database. Make changes in the sandbox (localhost:5174).';
          window.alert(msg);
          return Promise.reject(new Error(msg));
        }
        return original(...args);
      };
    }
  }
}
