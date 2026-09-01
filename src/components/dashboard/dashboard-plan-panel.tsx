"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CheckSquare, Filter, Maximize2, Plus, Trash2, type LucideIcon } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { useDragHandle } from "@/components/dashboard/sortable-panel"
import type { ExportColumn } from "@/components/shared/export-buttons"
import { cn } from "@/lib/utils"

interface DashboardPlanPanelProps<TData extends { id: string; status?: string }> {
  title: string
  icon: LucideIcon
  columns: ColumnDef<TData, unknown>[]
  // Wider column set shown only inside the expanded (Maximize2) dialog view —
  // falls back to `columns` when omitted.
  expandedColumns?: ColumnDef<TData, unknown>[]
  data: TData[]
  loading?: boolean
  emptyMessage?: string
  canAdd?: boolean
  addLabel?: string
  onAdd?: () => void
  canDelete?: boolean
  onDeleteSelected?: (ids: string[]) => Promise<void>
  // When provided, shows a CSV/Excel export menu in the panel header.
  exportColumns?: ExportColumn[]
  exportFileName?: string
  // When provided, rows become clickable (e.g. to open a nested detail panel)
  // instead of being purely informational.
  onRowClick?: (row: TData) => void
  // The panel's current resized height in px (from SortablePanel/PanelSize,
  // via daily-report-section.tsx) — used only to compute how many rows the
  // compact table shows (see computePageSize below). Omitted everywhere this
  // panel is reused outside the Daily Report's resizable grid, which just
  // falls back to the fixed 5-row default.
  panelHeight?: number
  // Forwarded straight to DataTable's tableContainerClassName — see its own
  // comment. Only the Filter Change/Collection Daily Report panels pass
  // this today (scrollbar-always-visible, see globals.css).
  tableContainerClassName?: string
}

// Everything in the compact table's chrome above/below the actual rows —
// header, status filter row, search bar, table header row, pagination
// footer, the panel's own vertical padding/gaps. Approximate (not measured),
// deliberately generous so the estimate undershoots rather than overshoots —
// DataTable's own overflow-auto is the safety net if it's still off.
const TABLE_CHROME_HEIGHT = 250
// h-10 header row + ~1px border-b per data row, from the shared Table/
// TableCell components' own classes.
const TABLE_ROW_HEIGHT = 41
const DEFAULT_PAGE_SIZE = 5

// More vertical room (a taller resized panel) shows more rows instead of
// leaving blank space below a fixed 5-row table — this is what actually
// makes a resize "count" for these panels, not just a bigger empty box.
function computePageSize(panelHeight: number | undefined): number {
  if (!panelHeight) return DEFAULT_PAGE_SIZE
  const availableForRows = panelHeight - TABLE_CHROME_HEIGHT
  if (availableForRows <= 0) return DEFAULT_PAGE_SIZE
  return Math.max(DEFAULT_PAGE_SIZE, Math.floor(availableForRows / TABLE_ROW_HEIGHT))
}

// One shared "compact daily panel" shell for the dashboard's Filter Change / Install /
// Repair / Collection grid — provides the filter, checkbox-select, and expand chrome
// on top of the existing DataTable, since no such panel chrome exists elsewhere yet.
export function DashboardPlanPanel<TData extends { id: string; status?: string }>({
  title,
  icon: Icon,
  columns,
  expandedColumns,
  data,
  loading,
  emptyMessage = "No items",
  canAdd,
  addLabel = "Add",
  onAdd,
  canDelete,
  onDeleteSelected,
  exportColumns,
  exportFileName,
  onRowClick,
  panelHeight,
  tableContainerClassName,
}: DashboardPlanPanelProps<TData>) {
  const dragHandle = useDragHandle()
  const [showStatusFilter, setShowStatusFilter] = React.useState(false)
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [selectMode, setSelectMode] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [expanded, setExpanded] = React.useState(false)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const statusOptions = React.useMemo(
    () => Array.from(new Set(data.map((d) => d.status).filter((s): s is string => !!s))),
    [data]
  )

  const filteredData = React.useMemo(() => {
    if (statusFilter === "all") return data
    return data.filter((d) => d.status === statusFilter)
  }, [data, statusFilter])

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const withSelectColumn = React.useCallback(
    (base: ColumnDef<TData, unknown>[]): ColumnDef<TData, unknown>[] => {
      if (!selectMode) return base
      const selectColumn: ColumnDef<TData, unknown> = {
        id: "__select",
        header: "",
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(row.original.id)}
            onCheckedChange={() => toggleSelected(row.original.id)}
            aria-label="Select row"
          />
        ),
      }
      return [selectColumn, ...base]
    },
    [selectMode, selected]
  )

  const compactColumns = React.useMemo(() => withSelectColumn(columns), [withSelectColumn, columns])
  const dialogColumns = React.useMemo(
    () => withSelectColumn(expandedColumns ?? columns),
    [withSelectColumn, expandedColumns, columns]
  )

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  const header = (
    <div className="flex min-w-0 max-w-full flex-col gap-2 @sm/card-header:flex-row @sm/card-header:items-center @sm/card-header:justify-between">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0 text-primary" /> <span className="truncate">{title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {canAdd && (
          <Button size="sm" className="h-7 gap-1 px-2" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" /> {addLabel}
          </Button>
        )}
        {exportColumns && (
          <PanelExportMenu
            columns={exportColumns}
            rows={filteredData}
            fileName={exportFileName ?? title.toLowerCase().replace(/\s+/g, "-")}
          />
        )}
        <Button
          variant={showStatusFilter ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          title="Filter by status"
          onClick={() => setShowStatusFilter((v) => !v)}
        >
          <Filter className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={selectMode ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          title="Select rows"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        >
          <CheckSquare className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Expand"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )

  const statusRow = showStatusFilter && (
    <Select value={statusFilter} onValueChange={setStatusFilter}>
      <SelectTrigger className="h-8 w-40">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Statuses</SelectItem>
        {statusOptions.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const selectionBar = selectMode && selected.size > 0 && (
    <div className={cn("flex items-center justify-between rounded-md border bg-muted/50 px-3 py-1.5 text-xs")}>
      <span>{selected.size} selected</span>
      {canDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-danger hover:text-danger"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      )}
    </div>
  )

  const table = (cols: ColumnDef<TData, unknown>[], pageSize: number) => (
    // flex-1/min-h-0 here (not just DataTable's own internal h-full) is what
    // actually makes DataTable grow to fill its share of CardContent's
    // space — a bare percentage height on a flex child doesn't reliably
    // fill available space without flex-grow. In the expanded dialog view
    // below, this wrapper's parent isn't a flex container, so these classes
    // are simply inert there — DataTable keeps sizing to its content as
    // before (already showing every row, no scaling needed).
    <div className="min-h-0 flex-1 flex flex-col">
      <DataTable
        columns={cols}
        data={filteredData}
        emptyMessage={emptyMessage}
        pageSize={pageSize}
        onRowClick={selectMode ? undefined : onRowClick}
        tableContainerClassName={tableContainerClassName}
      />
    </div>
  )

  return (
    <>
      <Card className="h-full flex flex-col">
        <CardHeader
          {...dragHandle}
          className={cn("gap-2 pb-2", dragHandle && "touch-none cursor-grab select-none active:cursor-grabbing")}
        >
          {header}
          {statusRow}
        </CardHeader>
        {/* flex-1 + min-h-0: fills whatever height this panel is resized to
            (min-h-0 is what lets a flex child actually shrink/scroll instead
            of being pushed to its content's natural size and overflowing
            the parent) — DataTable's own pageSize scales with that same
            height (see computePageSize) so a taller panel shows more rows
            instead of just more blank space below a fixed 5-row table. */}
        <CardContent className="flex-1 min-h-0 flex flex-col space-y-2">
          {selectionBar}
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
          ) : (
            table(compactColumns, computePageSize(panelHeight))
          )}
        </CardContent>
      </Card>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] flex flex-col gap-0 p-0">
          <DialogHeader className="border-b p-4 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" /> {title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
            {statusRow}
            {selectionBar}
            {table(dialogColumns, Math.max(filteredData.length, 1))}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${selected.size} item(s)?`}
        description="This will permanently remove the selected rows."
        loading={deleting}
        onConfirm={async () => {
          if (!onDeleteSelected) return
          setDeleting(true)
          try {
            await onDeleteSelected(Array.from(selected))
            exitSelectMode()
            setConfirmingDelete(false)
          } finally {
            setDeleting(false)
          }
        }}
      />
    </>
  )
}
