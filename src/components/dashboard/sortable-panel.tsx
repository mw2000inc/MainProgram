"use client"

import * as React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"

// Wraps one Daily Report panel with a drag handle — only rendered (and only
// actually draggable) for admins. Staff get the plain panel with no handle and
// no way to initiate a drag, since dnd-kit only responds to pointer/keyboard
// events on an element carrying {...listeners}, which this never attaches for
// them.
export function SortablePanel({
  id,
  isAdmin,
  children,
}: {
  id: string
  isAdmin: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !isAdmin,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "relative z-10 opacity-60")}>
      {isAdmin && (
        <div
          {...attributes}
          {...listeners}
          className="mb-1.5 flex min-h-11 touch-none items-center justify-center gap-1.5 rounded-md border border-dashed py-2.5 text-xs text-muted-foreground select-none hover:bg-muted/50 hover:text-foreground transition-colors cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" /> Drag to reorder
        </div>
      )}
      {children}
    </div>
  )
}
