import { v2ReadOnly } from '@/lib/v2Release';

// Sandbox writes stay local. Live writes are enabled explicitly for a reviewed
// deployment; other deployments retain the original read-only behavior.
export const V2_READ_ONLY = v2ReadOnly(import.meta.env);

export function assertV2Writable() {
  if (V2_READ_ONLY) {
    throw new Error('V2 changes are not enabled on this deployment.');
  }
}

// One choke point instead of guards sprinkled through every component:
// on a live-connected build, every entity write attempted from a /v2 route
// throws. V1 routes (the dispatch board etc.) keep full write access -
// dispatching IS production's job; the freeze is about V2 features only.
export function installV2LiveGuard(base44) {
  if (!V2_READ_ONLY) return;
  for (const entity of Object.values(base44.entities)) {
    for (const method of ['create', 'update', 'delete', 'bulkCreate']) {
      const original = entity[method];
      if (typeof original !== 'function') continue;
      entity[method] = (...args) => {
        if (window.location.pathname.startsWith('/v2')) {
          const msg = 'Read-only: V2 changes are not enabled on this deployment.';
          window.alert(msg);
          return Promise.reject(new Error(msg));
        }
        return original(...args);
      };
    }
  }
}
