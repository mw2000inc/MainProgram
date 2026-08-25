"use client"

import * as React from "react"
import type { PanelSize } from "@/lib/types"

const MIN_WIDTH = 260
const MIN_HEIGHT = 140

// Makes the whole panel (not a control inside it) resizable by dragging its
// bottom-right corner — admin-only, same permission shape as the drag-reorder
// handles: the handle simply isn't rendered for staff, so there's nothing for
// them to grab regardless of any other state.
//
// This div only ever sets its own `height` — `width` is applied one level up,
// on SortablePanel's root div, since that's the element that's actually a
// flex/grid item in "grid" layout mode (flex-basis/width on a non-flex-item
// nested div has no effect on the wrapping layout). The resize handle still
// measures and reports both dimensions; the caller just routes `width` to
// the right place.
export function ResizablePanel({
  panelId,
  isAdmin,
  savedSize,
  onResizeEnd,
  children,
}: {
  panelId: string
  isAdmin: boolean
  savedSize?: PanelSize
  onResizeEnd: (panelId: string, size: PanelSize) => void
  children: React.ReactNode
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [liveSize, setLiveSize] = React.useState<PanelSize | null>(null)
  const [resizing, setResizing] = React.useState(false)
  const size = liveSize ?? savedSize

  function handlePointerDown(e: React.PointerEvent) {
    if (!isAdmin) return
    const el = containerRef.current
    if (!el) return
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const startWidth = el.offsetWidth
    const startHeight = el.offsetHeight
    setResizing(true)

    // Plain closure variable, not React state — safe to read from handleUp
    // without going through a setState updater (which React may invoke during
    // this component's own render, making it the wrong place to call a prop
    // that updates the parent).
    let latest: PanelSize = { width: startWidth, height: startHeight }

    function handleMove(ev: PointerEvent) {
      const nextWidth = Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX))
      const nextHeight = Math.max(MIN_HEIGHT, startHeight + (ev.clientY - startY))
      latest = { width: nextWidth, height: nextHeight }
      setLiveSize(latest)
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      setResizing(false)
      onResizeEnd(panelId, latest)
    }
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
  }

  return (
    <div
      ref={containerRef}
      style={{ height: size?.height ? `${size.height}px` : undefined }}
      // Horizontal overflow is intentionally never scrollable at this outer
      // level — the header must always fit within the panel's width (it
      // shrinks/wraps via container queries), and any inner content that's
      // legitimately wide (a data table) has its own dedicated
      // overflow-x-auto wrapper. If this div scrolled horizontally too,
      // dragging that inner scrollbar would drag the header out of view
      // along with it, which is exactly the bug being fixed.
      className="relative min-w-0 w-full max-w-full overflow-x-hidden overflow-y-auto"
    >
      {children}
      {isAdmin && (
        <div
          onPointerDown={handlePointerDown}
          role="separator"
          aria-label="Resize panel"
          className="absolute bottom-0 right-0 z-10 h-5 w-5 touch-none cursor-nwse-resize"
        >
          <svg viewBox="0 0 16 16" className="h-full w-full text-muted-foreground/50 hover:text-muted-foreground">
            <path
              d="M13 13L13 9M13 13L9 13M13 13L4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
      {resizing && <div className="fixed inset-0 z-50 cursor-nwse-resize" />}
    </div>
  )
}
