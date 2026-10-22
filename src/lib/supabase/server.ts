import "server-only"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { supabaseCookieOptions } from "./cookie-options"

// Server-side client for Route Handlers — reads the caller's session from
// cookies so we can verify who's making the request before doing anything privileged.
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: supabaseCookieOptions,
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Route Handlers can write cookies; ignore if called from a context that can't.
          }
        },
      },
    }
  )
}
