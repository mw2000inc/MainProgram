"use client"

import * as React from "react"
import { Pencil, Trash2, ChevronLeft, ChevronRight, Maximize2, Minimize2, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useReportDetailPanelOpen } from "@/lib/sidebar-collapse-context"

// AppSheet-style split view: a list on the left, a persistent (non-modal, non-
// portal) detail panel on the right for whichever row is selected. Nothing
// here renders in a Dialog/Sheet overlay — the panel is a plain element that
// sits in the page's own grid next to the list, so list interactions are
// never blocked by a backdrop.

export function DetailField({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-sm text-muted-foreground mb-1.5">{label}</p>
      <div className="text-base font-medium wrap-break-word">
        {value === undefined || value === null || value === "" ? "—" : value}
      </div>
    </div>
  )
}

// Tracks which row (by id) is open in the panel, and steps to the previous/
// next row within whatever `rows` currently holds — pass the list's
// currently-visible (post search/filter) rows, not necessarily the full
// unfiltered dataset, so Previous/Next follows what the admin is actually
// looking at.
//
// `initialId` seeds the initial selection (e.g. from a `?id=` deep link) —
// pass it once on first render, not on every render, since it only affects
// the `useState` initializer.
export function useSplitViewSelection<T extends { id: string }>(rows: T[], initialId?: string) {
  const [selectedId, setSelectedId] = React.useState<string | null>(initialId ?? null)
  const [expanded, setExpanded] = React.useState(false)

  const index = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1
  const selected = index >= 0 ? rows[index] : null

  // Collapses the main nav rail to icon-only for as long as this panel is
  // open, freeing up horizontal space for the list + detail split.
  useReportDetailPanelOpen(!!selected)

  // If the selected row drops out of the current filtered set (search
  // narrows it out, or it was just deleted), close instead of showing stale
  // or empty content. Gated on `rows.length > 0` so a `?id=` deep link isn't
  // immediately cleared while the backing query is still loading (`rows` is
  // briefly `[]` before react-query resolves).
  React.useEffect(() => {
    if (selectedId && index === -1 && rows.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(null)
      setExpanded(false)
    }
  }, [selectedId, index, rows.length])

  return {
    selected,
    isOpen: !!selected,
    hasPrev: index > 0,
    hasNext: index >= 0 && index < rows.length - 1,
    expanded,
    setExpanded,
    open: (row: T) => setSelectedId(row.id),
    close: () => {
      setSelectedId(null)
      setExpanded(false)
    },
    prev: () => index > 0 && setSelectedId(rows[index - 1].id),
    next: () => index >= 0 && index < rows.length - 1 && setSelectedId(rows[index + 1].id),
  }
}

// Grid shell: list + panel side by side once something is selected; the
// panel takes over the full width when expanded (the list is unmounted, not
// hidden, while expanded — cheap since it re-syncs from the query cache).
export function SplitViewLayout({
  list,
  detail,
  isOpen,
  expanded,
  // Pages that already have their own left-hand sidebar (e.g. Filter Change's
  // month-group list) would get a cramped 3-way split at "lg" — bump the
  // breakpoint for those so the detail column only kicks in on wider screens.
  breakpoint = "lg",
  // "wide" (default): list fills remaining space, detail is a fixed 400px
  // sidebar — the usual data-table-plus-preview split. "narrow": the list is
  // just a slim record picker (e.g. a single "Order Number" column) and the
  // detail panel takes the remaining space instead, matching AppSheet's own
  // list-is-a-picker layout once a record is drilled into.
  listWidth = "wide",
}: {
  list: React.ReactNode
  detail: React.ReactNode
  isOpen: boolean
  expanded: boolean
  breakpoint?: "lg" | "xl"
  listWidth?: "wide" | "narrow"
}) {
  if (isOpen && expanded) {
    return <div>{detail}</div>
  }
  const narrow = listWidth === "narrow"
  return (
    <div
      className={cn(
        "grid grid-cols-1 items-start gap-4",
        // Both arbitrary-value classes are written out in full (not built via
        // string interpolation) so Tailwind's static scanner picks them up.
        isOpen && breakpoint === "lg" && !narrow && "lg:grid-cols-[minmax(0,1fr)_400px]",
        isOpen && breakpoint === "lg" && narrow && "lg:grid-cols-[280px_minmax(0,1fr)]",
        isOpen && breakpoint === "xl" && !narrow && "xl:grid-cols-[minmax(0,1fr)_400px]",
        isOpen && breakpoint === "xl" && narrow && "xl:grid-cols-[280px_minmax(0,1fr)]"
      )}
    >
      <div className="min-w-0">{list}</div>
      {isOpen && <div className="min-w-0">{detail}</div>}
    </div>
  )
}

export function DetailPanel({
  title,
  icon: Icon,
  subtitle,
  onEdit,
  onDelete,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  expanded,
  onToggleExpand,
  onClose,
  children,
  // Extra content (e.g. related-record sections) rendered below the core
  // field grid, in the same scrollable panel — not part of the label/value
  // grid itself, so it isn't forced into a two-column cell.
  extra,
}: {
  title: string
  icon?: LucideIcon
  subtitle?: React.ReactNode
  onEdit?: () => void
  onDelete?: () => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  expanded: boolean
  onToggleExpand: () => void
  onClose: () => void
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <Card className={cn(expanded && "min-h-[70vh]")}>
      <CardHeader className="flex-row items-center justify-between gap-2 border-b">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
            <h2 className="truncate font-semibold">{title}</h2>
          </div>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onEdit && (
            <Button className="gap-1.5 rounded-full px-3.5" title="Edit" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
          <div className="flex items-center gap-0.5">
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-danger hover:text-danger"
                title="Delete"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Previous" onClick={onPrev} disabled={!hasPrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Next" onClick={onNext} disabled={!hasNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={expanded ? "Collapse" : "Expand"}
              onClick={onToggleExpand}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-8 pt-6">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">{children}</div>
        {extra && <div className="space-y-6">{extra}</div>}
      </CardContent>
    </Card>
  )
}

// The clickable identifying cell (Name / Order No. / etc.) that opens the
// panel — matches the existing `hover:underline font-medium` link styling
// used for row-identifying cells elsewhere in the app, but triggers the
// split view instead of a navigation.
export function DetailOpenButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="font-medium text-left hover:underline"
    >
      {children}
    </button>
  )
}
