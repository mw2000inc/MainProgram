"use client"

import * as React from "react"

interface SidebarCollapseContextValue {
  collapsed: boolean
  registerOpen: (open: boolean) => void
}

const SidebarCollapseContext = React.createContext<SidebarCollapseContextValue>({
  collapsed: false,
  registerOpen: () => {},
})

// Tracks how many split-view detail panels are open across the app at once —
// usually one, but a nested panel (e.g. a member's related-sale detail inside
// the member's own panel) can be open alongside its parent — so the sidebar
// only re-expands once every panel that asked for it has closed.
export function SidebarCollapseProvider({ children }: { children: React.ReactNode }) {
  const [openCount, setOpenCount] = React.useState(0)

  const registerOpen = React.useCallback((open: boolean) => {
    setOpenCount((count) => Math.max(0, count + (open ? 1 : -1)))
  }, [])

  const value = React.useMemo(() => ({ collapsed: openCount > 0, registerOpen }), [openCount, registerOpen])

  return <SidebarCollapseContext.Provider value={value}>{children}</SidebarCollapseContext.Provider>
}

export function useSidebarCollapse() {
  return React.useContext(SidebarCollapseContext)
}

// Reports isOpen to the nearest SidebarCollapseProvider for as long as it
// stays true, so the main nav rail auto-collapses while a split-view detail
// panel is open and re-expands once none are (including on unmount, e.g. the
// admin navigates away without explicitly closing the panel first).
export function useReportDetailPanelOpen(isOpen: boolean) {
  const { registerOpen } = useSidebarCollapse()
  React.useEffect(() => {
    if (!isOpen) return
    registerOpen(true)
    return () => registerOpen(false)
  }, [isOpen, registerOpen])
}
