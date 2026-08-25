"use client"

import * as React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"

type DragHandleProps = React.HTMLAttributes<HTMLElement>

const DragHandleContext = React.createContext<DragHandleProps | null>(null)

// Lets a panel's own header opt into being the drag handle, instead of
// SortablePanel rendering a separate "Drag to reorder" bar above it. Returns
// null (spread as {}) outside a SortablePanel — e.g. DashboardPlanPanel is
// also reused on pages that have nothing to do with the Daily Report's
// drag-reorder, and this keeps those completely unaffected — and for staff,
// since SortablePanel only provides real listeners when isAdmin.
export function useDragHandle(): DragHandleProps | null {
  return React.useContext(DragHandleContext)
}

// Wraps one Daily Report panel with dnd-kit's sortable behavior — only
// actually draggable for admins (`disabled: !isAdmin` means dnd-kit never
// responds to a non-admin's pointer/keyboard events regardless of what's
// rendered). The drag handle itself is the panel's own header/title area,
// via useDragHandle() above — nested buttons (Add, export, filter, etc.)
// keep working normally, since dnd-kit's activation-distance threshold only
// turns a press-and-release-without-moving into a drag, not a click.
//
// Also owns the panel's `width` — not ResizablePanel, one level in — since
// this outer div is the actual flex/grid item in "grid" layout mode, and a
// width/flex-basis set on a nested non-flex-item div has no effect on the
// surrounding layout.
export function SortablePanel({
  id,
  isAdmin,
  width,
  defaultWidthClassName,
  children,
}: {
  id: string
  isAdmin: boolean
  width?: number
  // Fallback width class applied only until this panel has an explicit
  // saved/live width — once one exists, the inline `width` below always
  // wins over a class.
  defaultWidthClassName?: string
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !isAdmin,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: width ? `${width}px` : undefined,
    maxWidth: "100%",
  }

  const dragHandleProps = React.useMemo<DragHandleProps | null>(
    () => (isAdmin ? { ...attributes, ...listeners } : null),
    [isAdmin, attributes, listeners]
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("min-w-0", !width && defaultWidthClassName, isDragging && "relative z-10 opacity-60")}
    >
      <DragHandleContext.Provider value={dragHandleProps}>{children}</DragHandleContext.Provider>
    </div>
  )
}
