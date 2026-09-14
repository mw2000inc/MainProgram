"use client"

import * as React from "react"

// Shared by the three approval panels' own Full-Screen toggle (Daily
// Report/Pending Approvals, Dispatch Approval, Inventory Approval) — just
// the boolean state + Escape-to-exit wiring, since each panel's own markup
// differs too much (a plain Card sometimes rendered as a page tab vs. two
// Dialog-wrapped queues) to also share the JSX itself.
//
// The Escape listener is scoped to only exist while actually full-screen,
// and stops propagation so it doesn't also trigger whatever else Escape
// might otherwise do on the page underneath. For the two Dialog-based
// panels, Radix's own Escape-to-close-the-dialog handling is intercepted
// separately via DialogContent's own onEscapeKeyDown prop (this window
// listener alone can't reliably win a race against Radix's internal
// document-level listener) — see dispatch-approval-queue.tsx/
// stock-movement-approval-queue.tsx's own use of `exit` there.
export function useFullScreenToggle() {
  const [isFullScreen, setIsFullScreen] = React.useState(false)

  const enter = React.useCallback(() => setIsFullScreen(true), [])
  const exit = React.useCallback(() => setIsFullScreen(false), [])
  const toggle = React.useCallback(() => setIsFullScreen((v) => !v), [])

  React.useEffect(() => {
    if (!isFullScreen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      e.stopPropagation()
      setIsFullScreen(false)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [isFullScreen])

  return { isFullScreen, enter, exit, toggle }
}
