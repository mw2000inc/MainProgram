"use client"

import * as React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"
import type { PanelSize } from "@/lib/types"

type DragHandleProps = React.HTMLAttributes<HTMLElement>

const DragHandleContext = React.createContext<DragHandleProps | null>(null)

// Lets a panel's own header opt into being the drag-to-reorder handle,
// instead of SortablePanel rendering a separate "Drag to reorder" bar above
// it. Returns null (spread as {}) outside a SortablePanel — e.g.
// DashboardPlanPanel is also reused on pages that have nothing to do with
// the Daily Report's drag-reorder, and this keeps those completely
// unaffected — and for a non-admin, since SortablePanel only provides real
// listeners when isAdmin.
export function useDragHandle(): DragHandleProps | null {
  return React.useContext(DragHandleContext)
}

// Low enough that 3 resized-down panels + 2 grid-mode gaps (gap-6 = 24px
// each) still fit within a typical desktop's content width once the sidebar
// (collapsed to 64px while Daily Report is open) and page padding are
// subtracted — e.g. 3*220 + 48 = 708px, comfortably under even a ~900px
// content area. A data table panel narrower than this still degrades
// cleanly (its table scrolls internally; the header wraps), so this isn't a
// usability floor, just the point where 3-per-row stops being reachable.
const MIN_WIDTH = 220
const MIN_HEIGHT = 140

type ResizeEdge = "left" | "right" | "top" | "bottom" | "corner"

// Wraps one Daily Report panel with dnd-kit's sortable (reorder) behavior
// AND resize (width via the left/right edges, height via the top/bottom
// edges, both together via the corner) — only actually interactive for
// admins (`disabled: !isAdmin` on useSortable, and the resize handles simply
// aren't rendered otherwise, same permission shape both ways). The
// drag-to-reorder handle is the panel's own header/title area, via
// useDragHandle() above — nested buttons (Add, export, filter, etc.) keep
// working normally, since dnd-kit's activation-distance threshold only
// turns a press-and-release-without-moving into a drag, not a click.
// Resize is a separate gesture entirely (plain pointer listeners on
// dedicated edge/corner strips, not dnd-kit), so there's no chance of the
// two interpreting the same gesture differently — the top edge does sit
// close to the header (the reorder handle), so it's deliberately offset
// mostly into the gap above the panel rather than over the header itself;
// see its own comment below for exactly how much overlap that leaves.
//
// Resize used to live one level in, on a separate ResizablePanel — merged
// in here because this is the element that's actually the flex item (owns
// width), so live-previewing width during a drag (not just on release,
// which is all the old split allowed) needs the handle and the width style
// on the same node.
export function SortablePanel({
  id,
  isAdmin,
  width,
  height,
  defaultWidthClassName,
  onResizeEnd,
  children,
}: {
  id: string
  isAdmin: boolean
  width?: number
  height?: number
  // Fallback width class applied only until this panel has an explicit
  // saved/live width — once one exists, the inline `width` below always
  // wins over a class.
  defaultWidthClassName?: string
  onResizeEnd?: (size: PanelSize) => void
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !isAdmin,
  })

  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      setNodeRef(node)
    },
    [setNodeRef]
  )

  const [liveSize, setLiveSize] = React.useState<PanelSize | null>(null)
  const [resizingEdge, setResizingEdge] = React.useState<ResizeEdge | null>(null)
  const currentWidth = liveSize?.width ?? width
  const currentHeight = liveSize?.height ?? height

  // A single stable handler (not a per-render "factory" that returns a new
  // closure per edge) — the React Compiler's ref-safety check flags a ref
  // read inside a function created fresh during render as an unsafe
  // ref-during-render access, even when that function only actually runs
  // later, as a real event handler. useCallback is the recognized-safe
  // pattern for that; the edge is passed as an argument from each handle's
  // onPointerDown instead of being closed over.
  const handleResizePointerDown = React.useCallback(
    (edge: ResizeEdge, e: React.PointerEvent) => {
      if (!isAdmin) return
      const el = rootRef.current
      if (!el) return
      // Stop this from also being picked up as a drag-to-reorder gesture —
      // these handles are siblings of the header, not descendants of it, so
      // dnd-kit's listeners (only ever attached to the header via
      // useDragHandle) can't fire from here regardless, but stopping
      // propagation keeps that guarantee even if a future change nests
      // these differently.
      e.preventDefault()
      e.stopPropagation()

      const startX = e.clientX
      const startY = e.clientY
      const startWidth = el.offsetWidth
      const startHeight = el.offsetHeight
      setResizingEdge(edge)

      // Plain closure variable, not React state — safe to read from handleUp
      // without going through a setState updater (which React may invoke
      // during this component's own render, making it the wrong place to
      // call a prop that updates the parent).
      let latest: PanelSize = { width: startWidth, height: startHeight }

      function handleMove(ev: PointerEvent) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        // Right and corner both grow to the right (positive dx grows);
        // left grows to the left instead, so dragging the cursor further
        // left (negative dx) is what grows it — the natural direction for
        // that edge. Same idea vertically: bottom and corner grow downward
        // (positive dy), top grows upward (dragging further up grows it).
        // Neither axis moves for an edge that doesn't control it (e.g. top
        // never touches width). Flex-wrap/items-start has no independent
        // left/top position per item, so growing from the left or top edge
        // still extends the box's rendered width/height to the right/down
        // once committed (its top-left is anchored by the surrounding
        // layout) — same as growing from the right or bottom edge would.
        // What differs is just which direction of cursor movement triggers
        // growth, letting an admin grab whichever edge is more convenient
        // to reach.
        const widthDelta = edge === "left" ? -dx : edge === "right" || edge === "corner" ? dx : 0
        const heightDelta = edge === "top" ? -dy : edge === "bottom" || edge === "corner" ? dy : 0
        const nextWidth = Math.max(MIN_WIDTH, startWidth + widthDelta)
        const nextHeight = Math.max(MIN_HEIGHT, startHeight + heightDelta)
        latest = { width: nextWidth, height: nextHeight }
        setLiveSize(latest)
      }
      function handleUp() {
        window.removeEventListener("pointermove", handleMove)
        window.removeEventListener("pointerup", handleUp)
        setResizingEdge(null)
        onResizeEnd?.(latest)
      }
      window.addEventListener("pointermove", handleMove)
      window.addEventListener("pointerup", handleUp)
    },
    [isAdmin, onResizeEnd]
  )

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: currentWidth ? `${currentWidth}px` : undefined,
    height: currentHeight ? `${currentHeight}px` : undefined,
    maxWidth: "100%",
  }

  const dragHandleProps = React.useMemo<DragHandleProps | null>(
    () => (isAdmin ? { ...attributes, ...listeners } : null),
    [isAdmin, attributes, listeners]
  )

  return (
    <div
      ref={setRefs}
      style={style}
      className={cn(
        "relative min-w-0",
        !currentWidth && defaultWidthClassName,
        isDragging && "z-10 opacity-60",
        resizingEdge && "select-none"
      )}
    >
      {/* Scroll clipping lives on this inner wrapper, not the outer node —
          the resize handles below are its siblings, not its children, so
          they can straddle the panel's edges (half in the gap between
          panels) without being clipped by this div's own overflow. That
          also keeps the right-edge and corner handles clear of this
          content's own vertical scrollbar once it overflows: Windows always
          renders a visible, non-overlay scrollbar along the right edge
          (unlike macOS), which would otherwise compete with a handle
          sitting in or along that same strip. Horizontal overflow is
          intentionally never scrollable here — the header must always fit
          within the panel's width (it shrinks/wraps via container
          queries), and any inner content that's legitimately wide (a data
          table) has its own dedicated overflow-x-auto wrapper. If this
          scrolled horizontally too, dragging that inner scrollbar would
          drag the header out of view along with it. */}
      <div className="h-full min-w-0 w-full max-w-full overflow-x-hidden overflow-y-auto">
        <DragHandleContext.Provider value={dragHandleProps}>{children}</DragHandleContext.Provider>
      </div>

      {isAdmin && (
        <>
          <div
            onPointerDown={(e) => handleResizePointerDown("left", e)}
            role="separator"
            aria-label="Resize panel width from the left"
            aria-orientation="vertical"
            className="absolute inset-y-0 left-0 z-10 w-2.5 -translate-x-1/2 touch-none cursor-ew-resize rounded-full transition-colors hover:bg-primary/25"
          />
          <div
            onPointerDown={(e) => handleResizePointerDown("right", e)}
            role="separator"
            aria-label="Resize panel width from the right"
            aria-orientation="vertical"
            className="absolute inset-y-0 right-0 z-10 w-2.5 translate-x-1/2 touch-none cursor-ew-resize rounded-full transition-colors hover:bg-primary/25"
          />
          <div
            onPointerDown={(e) => handleResizePointerDown("top", e)}
            role="separator"
            aria-label="Resize panel height from the top"
            aria-orientation="horizontal"
            // Straddles the top boundary the same way the edge handles do
            // (-translate-y-1/2, half above/outside in the gap between
            // panels) — this one's the reason that matters most: the panel's
            // header sits right here too, and it's the drag-to-reorder
            // handle. Only ~5px of this strip's height actually overlaps the
            // header's own top edge; the rest is in the gap. That sliver
            // taking resize instead of reorder is an intentional, minor
            // trade-off — the header stays fully draggable everywhere else.
            className="absolute inset-x-0 top-0 z-10 h-2.5 -translate-y-1/2 touch-none cursor-ns-resize rounded-full transition-colors hover:bg-primary/25"
          />
          <div
            onPointerDown={(e) => handleResizePointerDown("bottom", e)}
            role="separator"
            aria-label="Resize panel height from the bottom"
            aria-orientation="horizontal"
            className="absolute inset-x-0 bottom-0 z-10 h-2.5 translate-y-1/2 touch-none cursor-ns-resize rounded-full transition-colors hover:bg-primary/25"
          />
          <div
            onPointerDown={(e) => handleResizePointerDown("corner", e)}
            role="separator"
            aria-label="Resize panel"
            // Sits just outside the panel's own bottom-right corner
            // (-bottom-1 -right-1), not flush against it — same reasoning
            // as the edge handles above, just for the corner specifically.
            // The hit target (h-7 w-7, p-1.5) is bigger than the visible
            // icon for easier grabbing without looking visually heavy.
            className="absolute -bottom-1 -right-1 z-20 h-7 w-7 touch-none cursor-nwse-resize p-1.5"
          >
            <svg viewBox="0 0 16 16" className="h-full w-full text-muted-foreground/70 hover:text-muted-foreground">
              <path
                d="M13 13L13 9M13 13L9 13M13 13L4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </>
      )}

      {resizingEdge && (
        <div
          className={cn(
            "fixed inset-0 z-50",
            resizingEdge === "corner" ? "cursor-nwse-resize" : resizingEdge === "top" || resizingEdge === "bottom" ? "cursor-ns-resize" : "cursor-ew-resize"
          )}
        />
      )}
    </div>
  )
}
