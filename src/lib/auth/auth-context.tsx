"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase/client"
import type { Role, User } from "@/lib/types"

export type Permission =
  | "customers:add"
  | "customers:edit"
  | "customers:delete"
  | "sales:add"
  | "sales:edit"
  | "sales:delete"
  | "inventory:add"
  | "inventory:edit"
  | "inventory:delete"
  | "users:manage"
  | "settings:manage"

const STAFF_ALLOWED: Permission[] = [
  "customers:add",
  "customers:edit",
  "sales:add",
]

interface AuthContextValue {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
  can: (permission: Permission) => boolean
  refreshUser: () => Promise<void>
}

// Exported (only) so a dev-only mock-data preview route can supply a fake
// value via <AuthContext.Provider> without touching real Supabase auth.
export const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Retries on transient failures (e.g. a network blip) so a real, still-valid Supabase
// session is never mistaken for "logged out" just because one profile fetch failed.
async function loadProfile(session: Session | null, retries = 2): Promise<User | null> {
  if (!session) return null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, role, avatar_url, phone, created_at")
      .eq("id", session.user.id)
      .single()
    if (!error && data) {
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        avatarUrl: data.avatar_url ?? undefined,
        phone: data.phone ?? undefined,
        createdAt: data.created_at,
      }
    }
    if (attempt < retries) await sleep(500 * (attempt + 1))
  }
  return null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)
  const router = useRouter()

  React.useEffect(() => {
    let active = true
    // One-time bootstrap of the existing session on mount (client-only external system).
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        if (!active) return
        setUser(null)
        setLoading(false)
        return
      }
      const profile = await loadProfile(data.session)
      if (!active) return
      // Only a genuinely absent session means "logged out" — a failed profile fetch
      // while the session is still valid should never sign the user out.
      if (profile) setUser(profile)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        if (active) {
          setUser(null)
          setLoading(false)
        }
        return
      }
      const profile = await loadProfile(session)
      if (!active) return
      if (profile) setUser(profile)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const refreshUser = React.useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      setUser(null)
      return
    }
    const profile = await loadProfile(data.session)
    if (profile) setUser(profile)
  }, [])

  const logout = React.useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    router.push("/login")
  }, [router])

  const can = React.useCallback(
    (permission: Permission) => {
      if (!user) return false
      if (user.role === "admin") return true
      return STAFF_ALLOWED.includes(permission)
    },
    [user]
  )

  const value = React.useMemo(
    () => ({ user, loading, logout, can, refreshUser }),
    [user, loading, logout, can, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}

export function roleLabel(role: Role) {
  return role === "admin" ? "Admin" : "Staff"
}
