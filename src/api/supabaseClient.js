import { createClient } from '@supabase/supabase-js'
import { getAccessToken, onTokenChange } from './authClient'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Every request carries the edge-function-issued JWT when we have one;
// without one (login page, or pre-RLS-flip clients) fall back to the anon key.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => (await getAccessToken()) ?? supabaseAnonKey,
})

// Realtime channels authenticate separately — keep their token current,
// including on initial page load when the stored token is still valid.
onTokenChange((token) => supabase.realtime.setAuth(token ?? supabaseAnonKey))
getAccessToken().then((token) => {
  if (token) supabase.realtime.setAuth(token)
})
