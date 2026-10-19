// A deployment switch, not an authorization boundary. Database policies and
// server-side permissions still decide which signed-in users may write.
export function v2ReadOnly(env) {
  return env.MODE !== 'sandbox' && env.VITE_V2_LIVE_WRITES !== 'true';
}
