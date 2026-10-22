import { createBrowserClient } from "@supabase/ssr"
import { supabaseCookieOptions } from "./cookie-options"

// Singleton browser client — safe to import from any client component.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: supabaseCookieOptions }
  )
}

export const supabase = createClient()
