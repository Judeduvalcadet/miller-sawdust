// Shared helpers for the Miller Sawdust auth edge functions.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignJWT, jwtVerify } from 'npm:jose@5'

export const service = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Must equal the project's JWT secret (Dashboard → Settings → API → JWT Secret)
// so PostgREST / Realtime / Storage accept the tokens we sign:
//   supabase secrets set APP_JWT_SECRET=<jwt secret>
const JWT_SECRET = new TextEncoder().encode(Deno.env.get('APP_JWT_SECRET') ?? '')

export const ACCESS_TOKEN_TTL = '12h'
export const SESSION_DAYS = 30

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return null
}

export interface DriverRow {
  id: string
  name: string
  role: string
  active: boolean
}

export async function signAccessToken(driver: DriverRow): Promise<string> {
  return await new SignJWT({
    role: 'authenticated', // Postgres role PostgREST switches to
    app_role: driver.role,
    name: driver.name,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(driver.id)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(JWT_SECRET)
}

// Verifies an access token WE issued (the anon key fails the audience check).
export async function verifyAccessToken(req: Request): Promise<Record<string, unknown> | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { audience: 'authenticated' })
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function newRefreshSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// The reversible hash the pre-migration client used. Kept only to lazily
// migrate stragglers and keep old bundles working until the RLS flip.
export function legacyHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash = hash & hash
  }
  return hash.toString()
}

export function sessionExpiry(): string {
  const d = new Date()
  d.setDate(d.getDate() + SESSION_DAYS)
  return d.toISOString()
}

export async function createSession(driverId: string, deviceId: string | null) {
  const secret = newRefreshSecret()
  const { data, error } = await service
    .from('driver_sessions')
    .insert({
      driver_id: driverId,
      device_id: deviceId,
      last_used_at: new Date().toISOString(),
      expires_at: sessionExpiry(),
      token_hash: await sha256hex(secret),
    })
    .select()
    .single()
  if (error) throw error
  return { refreshToken: `${data.id}.${secret}` }
}

export async function tokenResponse(driver: DriverRow, refreshToken: string) {
  return {
    access_token: await signAccessToken(driver),
    refresh_token: refreshToken,
    driver: { id: driver.id, name: driver.name, role: driver.role },
  }
}
