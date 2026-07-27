// Client side of the edge-function auth flow. Owns token storage, silent
// renewal, and the one-time exchange of legacy (pre-JWT) sessions.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const KEYS = {
  jwt: 'miller_jwt',
  refresh: 'miller_refresh_token',
  session: 'miller_session_id',
  driverId: 'miller_driver_id',
  driverName: 'miller_driver_name',
  driverRole: 'miller_driver_role',
}

// -- token change listeners (supabaseClient uses this to keep realtime authed)

const listeners = []
export function onTokenChange(cb) {
  listeners.push(cb)
}
function emit(token) {
  listeners.forEach((cb) => cb(token))
}

// -- helpers

async function callFn(name, body, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken || ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {
      status: res.status,
      code: data.error,
    })
  }
  return data
}

function decodeExp(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).exp || 0
  } catch {
    return 0
  }
}

export function getDeviceId() {
  let deviceId = localStorage.getItem('miller_device_id')
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + Date.now()
    localStorage.setItem('miller_device_id', deviceId)
  }
  return deviceId
}

function storeTokens({ access_token, refresh_token, driver }) {
  localStorage.setItem(KEYS.jwt, access_token)
  localStorage.setItem(KEYS.refresh, refresh_token)
  // Keep the legacy session id around too — it's what ties this device to its
  // session row, and older code paths still read it as the "logged in" flag.
  localStorage.setItem(KEYS.session, refresh_token.split('.')[0])
  if (driver) {
    localStorage.setItem(KEYS.driverId, driver.id)
    localStorage.setItem(KEYS.driverName, driver.name)
    localStorage.setItem(KEYS.driverRole, driver.role)
  }
  emit(access_token)
}

function clearAll() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k))
  emit(null)
}

// -- access token with silent renewal (single-flight)

let inflight = null

export async function getAccessToken() {
  const token = localStorage.getItem(KEYS.jwt)
  if (token && decodeExp(token) * 1000 > Date.now() + 60_000) return token
  if (!inflight) {
    inflight = renew().finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function renew() {
  const refresh = localStorage.getItem(KEYS.refresh)
  if (refresh) {
    try {
      const data = await callFn('refresh', { refresh_token: refresh })
      storeTokens(data)
      return data.access_token
    } catch (e) {
      // Only give up on this refresh token if the server rejected it;
      // on network errors keep it and retry next call.
      if (e.status !== 401) return null
      localStorage.removeItem(KEYS.jwt)
      localStorage.removeItem(KEYS.refresh)
    }
  }
  // Legacy session created by the pre-JWT client: exchange it once, silently.
  const legacy = localStorage.getItem(KEYS.session)
  if (legacy) {
    try {
      const data = await callFn('exchange-session', {
        session_id: legacy,
        device_id: getDeviceId(),
      })
      storeTokens(data)
      return data.access_token
    } catch {
      return null
    }
  }
  return null
}

// -- auth actions

export async function login(driverId, pin) {
  const data = await callFn('login', {
    driver_id: driverId,
    pin,
    device_id: getDeviceId(),
  })
  storeTokens(data)
  return data.driver
}

export async function logout() {
  const refresh = localStorage.getItem(KEYS.refresh)
  const session = localStorage.getItem(KEYS.session)
  try {
    if (refresh || session) {
      await callFn('logout', { refresh_token: refresh, session_id: session })
    }
  } catch {
    // best effort — the session row expires on its own
  }
  clearAll()
}

export async function setPin(driverId, pin) {
  const token = await getAccessToken()
  return callFn('set-pin', { driver_id: driverId, pin }, token)
}
