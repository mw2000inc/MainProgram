"use client"

import * as React from "react"
import { useAuth } from "@/lib/auth/auth-context"

export type SidebarMode = "automatic" | "icon-only" | "with-names"

const DEFAULT_MODE: SidebarMode = "automatic"

function storageKey(userId: string): string {
  // Namespaced per user id so two different people logging into the same
  // shared browser/device never inherit each other's preference.
  return `mw2000-sidebar-mode-${userId}`
}

function readStoredMode(userId: string): SidebarMode {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (raw === "automatic" || raw === "icon-only" || raw === "with-names") return raw
  } catch {
    // localStorage can throw in some contexts (private browsing, blocked
    // storage) — fall through to the default rather than ever breaking the
    // page over a display preference.
  }
  return DEFAULT_MODE
}

interface SidebarCollapseContextValue {
  collapsed: boolean
  registerOpen: (open: boolean) => void
  mode: SidebarMode
  setMode: (mode: SidebarMode) => void
}

const SidebarCollapseContext = React.createContext<SidebarCollapseContextValue>({
  collapsed: false,
  registerOpen: () => {},
  mode: DEFAULT_MODE,
  setMode: () => {},
})

// Tracks how many split-view detail panels (or whole pages, e.g. Sale List /
// Daily Report) are asking for the sidebar to auto-collapse at once — usually
// one, but a nested panel can be open alongside its parent, so this only
// re-expands once every registration has cleared. This is the "automatic"
// behavior; it's overridden entirely by an explicit per-person mode below.
export function SidebarCollapseProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [openCount, setOpenCount] = React.useState(0)
  // Starts at the default on every render (server and client alike) to
  // avoid a hydration mismatch — localStorage doesn't exist on the server —
  // then synced from the real stored value below, after mount, same pattern
  // as the login page's own "remembered email" read.
  const [mode, setModeState] = React.useState<SidebarMode>(DEFAULT_MODE)

  React.useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(readStoredMode(user.id))
  }, [user])

  const registerOpen = React.useCallback((open: boolean) => {
    setOpenCount((count) => Math.max(0, count + (open ? 1 : -1)))
  }, [])

  const setMode = React.useCallback(
    (next: SidebarMode) => {
      setModeState(next)
      if (!user) return
      try {
        window.localStorage.setItem(storageKey(user.id), next)
      } catch {
        // Same as readStoredMode — never let a storage failure break the UI,
        // it just won't persist across a reload.
      }
    },
    [user]
  )

  // An explicit mode always wins over the automatic per-page registrations —
  // "icon-only"/"with-names" mean exactly that, everywhere, all the time.
  // "automatic" (the default) is the only mode where those registrations
  // matter at all, preserving today's existing behavior unchanged.
  const collapsed = mode === "icon-only" ? true : mode === "with-names" ? false : openCount > 0

  const value = React.useMemo(
    () => ({ collapsed, registerOpen, mode, setMode }),
    [collapsed, registerOpen, mode, setMode]
  )

  return <SidebarCollapseContext.Provider value={value}>{children}</SidebarCollapseContext.Provider>
}

export function useSidebarCollapse() {
  return React.useContext(SidebarCollapseContext)
}

// Reports isOpen to the nearest SidebarCollapseProvider for as long as it
// stays true, so the main nav rail auto-collapses while a split-view detail
// panel is open and re-expands once none are (including on unmount, e.g. the
// admin navigates away without explicitly closing the panel first). A no-op
// whenever an explicit mode override is active (see SidebarCollapseProvider),
// since registerOpen still runs but collapsed no longer depends on it.
export function useReportDetailPanelOpen(isOpen: boolean) {
  const { registerOpen } = useSidebarCollapse()
  React.useEffect(() => {
    if (!isOpen) return
    registerOpen(true)
    return () => registerOpen(false)
  }, [isOpen, registerOpen])
}
