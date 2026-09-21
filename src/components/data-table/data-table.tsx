"use client"

import * as React from "react"
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n/i18n-context"

// Lets a column definition carry its own header/cell width and padding
// overrides (e.g. Member List's fixed-width columns — see
// customers-columns.tsx) without every other column needing to know or
// care. Additive: a column that never sets `meta` renders exactly as
// before, since these are read with `?.` everywhere below.
declare module "@tanstack/react-table" {
  // Both type params are required here to match TanStack's own ColumnMeta
  // signature for declaration merging, even though neither is referenced
  // in the body below.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    headerClassName?: string
    cellClassName?: string
  }
}

// Sentinel pageSize meaning "show every row on one page" — Number.
// MAX_SAFE_INTEGER rather than data.length itself so this stays a stable,
// content-independent value: TanStack's own pageCount math
// (ceil(rowCount / pageSize)) always comes out to a single page for any
// real dataset this app renders, with no need to know or recompute the
// actual row count up front. Exported so a caller that wants to force
// "show everything, no rows-per-page control needed" can pass this
// explicitly instead of guessing a large-enough number (the inventory
// drilldown table and DashboardPlanPanel's own compact view already did
// exactly that with Math.max(rowCount, 1) before this existed).
export const DATA_TABLE_SHOW_ALL_PAGE_SIZE = Number.MAX_SAFE_INTEGER

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  searchPlaceholder?: string
  toolbar?: React.ReactNode
  onFilteredRowsChange?: (rows: TData[]) => void
  // Raw text currently typed into the search box — separate from
  // onFilteredRowsChange because an empty query and a query that happens to
  // match every row both produce a full-length filtered array; callers that
  // need to tell "no search active" apart from "search matched everything"
  // (e.g. the Member List's map panel deciding whether to re-focus on a top
  // match or fall back to its default view) need the raw string itself.
  onSearchChange?: (value: string) => void
  emptyMessage?: string
  pageSize?: number
  // Opt-in — no caller sets this by default. TanStack normally sends the
  // table back to page 1 whenever `data` changes identity, which includes a
  // plain refetch after an inline edit: someone editing a cell on page 4
  // would be bounced to page 1 by their own save. Provide a key and the
  // current page instead survives data refreshes, returning to page 1 only
  // when this key changes (the caller's "this is a different result set"
  // signal, e.g. a month/day filter), when the search text or sorting
  // changes, or when the page no longer exists (clamped to the last one).
  pageResetKey?: React.Key
  onRowClick?: (row: TData) => void
  // Extra className per row (e.g. strikethrough for completed/inactive entries).
  getRowClassName?: (row: TData) => string | undefined
  // Extra classes merged onto the one real scroll wrapper (see that div's
  // own comment below — both this and scrollContainerClassName land on the
  // SAME element now, ui/table.tsx's own container no longer scrolls at
  // all) — e.g. the Daily Report's Filter Change/Collection panels opt
  // into scrollbar-always-visible (see globals.css) so their wide,
  // inline-editable column set's horizontal scroll is obvious without a
  // hover/scroll gesture first. Every other call site leaves this unset
  // and gets the exact wrapper classes as before.
  tableContainerClassName?: string
  // Extra classes merged onto the actual <table> element (not its wrapper)
  // — e.g. an explicit min-w-[...] to guarantee the table itself is wide
  // enough to force the scroll wrapper's overflow-x-auto to actually
  // engage, regardless of how narrow any individual cell's own content
  // happens to be. Every other call site leaves this unset and gets the
  // plain w-full table as before.
  tableClassName?: string
  // Extra classes merged onto the same real scroll wrapper as
  // tableContainerClassName above. Every other call site leaves this
  // unset, so overflow-y-auto stays inert exactly as before (no bounded
  // height to actually clip/scroll against) — this is how a caller opts a
  // specific table into a real, fixed-height scrolling body (e.g.
  // `"max-h-[60vh]"`) without changing that behavior anywhere else in the
  // app.
  scrollContainerClassName?: string
  // Merged onto every <TableHead>/<TableCell> in this table instance (in
  // addition to any per-column meta.headerClassName/cellClassName a column
  // itself sets) — e.g. tighter uniform padding for a table under strict
  // fixed-width column constraints. Every other call site leaves these
  // unset and gets the plain base padding as before.
  headerCellClassName?: string
  bodyCellClassName?: string
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder,
  toolbar,
  onFilteredRowsChange,
  onSearchChange,
  emptyMessage,
  // Defaults to showing every row on one page rather than an arbitrary 10
  // — an admin opening any list (Pending Approvals, Member List, Schedule,
  // Inventory, ...) sees the full dataset immediately, no manual "rows per
  // page" bump needed first. A caller that still wants real pagination
  // (rare — none currently do) passes its own smaller pageSize, unaffected
  // by this default.
  pageSize = DATA_TABLE_SHOW_ALL_PAGE_SIZE,
  pageResetKey,
  onRowClick,
  getRowClassName,
  tableContainerClassName,
  tableClassName,
  scrollContainerClassName,
  headerCellClassName,
  bodyCellClassName,
}: DataTableProps<TData>) {
  const { t } = useTranslation("dataTable")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize })
  const keepPageOnRefresh = pageResetKey !== undefined
  const goToFirstPage = () => setPagination((p) => ({ ...p, pageIndex: 0 }))

  // A changed pageResetKey means a different result set — back to page 1.
  // Adjusted during render (not in an effect) for the same reason
  // InlineTextCell does it: an effect would paint one frame of the old page
  // first.
  const [lastPageResetKey, setLastPageResetKey] = React.useState(pageResetKey)
  if (pageResetKey !== lastPageResetKey) {
    setLastPageResetKey(pageResetKey)
    goToFirstPage()
  }

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: (updater) => {
      setSorting(updater)
      if (keepPageOnRefresh) goToFirstPage()
    },
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    autoResetPageIndex: !keepPageOnRefresh,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const search = String(filterValue).toLowerCase()
      return Object.values(row.original as Record<string, unknown>).some((value) =>
        String(value ?? "").toLowerCase().includes(search)
      )
    },
  })

  // With keepPageOnRefresh the page is no longer auto-reset, so if the data
  // shrank below the current page (rows edited out of the filter, etc.) snap
  // to the last page that still exists rather than showing an empty one.
  const lastPageIndex = Math.max(0, table.getPageCount() - 1)
  // Clamped inside the updater (not by comparing the value read above) so it
  // composes with a goToFirstPage() queued earlier in the same render — e.g.
  // a changed pageResetKey — instead of overriding it with a stale page.
  if (keepPageOnRefresh && pagination.pageIndex > lastPageIndex) {
    setPagination((p) => (p.pageIndex > lastPageIndex ? { ...p, pageIndex: lastPageIndex } : p))
  }

  const filteredRows = table.getFilteredRowModel().rows.map((r) => r.original)
  const filteredRowsKey = filteredRows.length + ":" + globalFilter

  React.useEffect(() => {
    onFilteredRowsChange?.(filteredRows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRowsKey])

  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination
  const totalRows = table.getFilteredRowModel().rows.length
  const startRow = totalRows === 0 ? 0 : pageIndex * currentPageSize + 1
  const endRow = Math.min(totalRows, (pageIndex + 1) * currentPageSize)

  return (
    // h-full + flex-1 only actually do anything when this is placed inside a
    // sized flex ancestor (e.g. a resized Daily Report panel's flex-1
    // CardContent, wrapped in its own flex-1 div — see dashboard-plan-panel's
    // table()) — flex-1 is what reliably claims that space as a flex child
    // (a bare percentage height on a flex item isn't a safe way to get it to
    // grow); h-full covers being placed in a plain sized block instead. With
    // no such ancestor (every other place this is used), both are simply
    // inert and this sizes to its content exactly as before. Same idea for
    // flex-1/min-h-0 on the table wrapper below: it only stretches/scrolls
    // when there's actual extra height to fill.
    <div className="h-full min-h-0 flex flex-1 flex-col space-y-3">
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => {
              setGlobalFilter(e.target.value)
              if (keepPageOnRefresh) goToFirstPage()
              onSearchChange?.(e.target.value)
            }}
            placeholder={searchPlaceholder ?? t("searchPlaceholder")}
            className="pl-8"
          />
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>

      {/* This is the ONE real scroll container for the whole table — both
          tableContainerClassName and scrollContainerClassName land here.
          ui/table.tsx's own inner container div used to also carry
          overflow-x-auto, on the theory that it could independently scroll
          horizontally while this outer div handled vertical scroll — a
          real headless-browser test proved that wrong: overflow-x: auto
          and overflow-y: visible cannot coexist on the same element (the
          browser unconditionally couples the axes), so that inner div was
          silently becoming its own dead-end vertical scroll container and
          swallowing position: sticky's binding before it ever reached this
          div. See ui/table.tsx's own comment for the full story. Now there
          is exactly one scrolling element between <thead> and the rest of
          the page, and both axes are handled together right here.

          h-full is what actually makes overflow-y-auto (and, with it,
          TableHeader's own sticky top-0) do anything — but a percentage
          height only ever resolves to something real when this div's own
          parent chain is itself height-bounded all the way up (a caller
          opting into a real flex-1 min-h-0 wrapper — see customers/
          page.tsx, and SplitViewLayout's own fillHeight prop for the
          Collection/Install/Filter Change/Repair/Inventory/Sale List
          pages). A caller that hasn't been restructured that way simply
          gets `auto` here — the table grows to its natural height and
          the ancestor page scrolls it normally instead, exactly as this
          whole app did before any of this sticky-header work — never
          broken, just not internally-scrolling. scrollContainerClassName
          overrides this per caller exactly as before (e.g. the Daily
          Report's own panels pass "max-h-[60vh]", or inside an
          already-scrolling fullscreen dialog, "overflow-y-visible
          max-h-none" — see pending-approvals-panel.tsx's
          tableScrollClassName and dashboard-plan-panel.tsx/inventory's
          in-and-out page for the same pattern).

          relative isn't load-bearing for the sticky computation itself
          (position: sticky binds to the nearest scrolling ancestor
          regardless of that ancestor's own position value) but pins down
          this div as the real containing block for anything absolutely
          positioned inside the table in the future, rather than leaving
          that implicit.

          w-full is likewise already implied by this being a flex-1 child
          of a flex-col parent (stretch is the cross-axis default),
          spelled out here anyway per the same defensive reasoning as
          relative above. */}
      <div
        className={cn(
          "relative h-full w-full min-h-0 flex-1 rounded-lg border overflow-x-auto overflow-y-auto",
          scrollContainerClassName,
          tableContainerClassName
        )}
      >
        <Table className={tableClassName}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sortDir = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(headerCellClassName, header.column.columnDef.meta?.headerClassName)}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortDir === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : sortDir === "desc" ? (
                            <ArrowDown className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className={cn("h-28 text-center text-muted-foreground", bodyCellClassName)}>
                  {emptyMessage ?? t("noRecordsFound")}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(onRowClick && "cursor-pointer hover:bg-muted/50", getRowClassName?.(row.original))}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(bodyCellClassName, cell.column.columnDef.meta?.cellClassName)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>
          {totalRows > 0 ? t("showingRange", { start: startRow, end: endRow, total: totalRows }) : t("noResults")}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span>{t("rowsPerPage")}</span>
            <Select
              value={currentPageSize === DATA_TABLE_SHOW_ALL_PAGE_SIZE ? "all" : String(currentPageSize)}
              onValueChange={(v) => table.setPageSize(v === "all" ? DATA_TABLE_SHOW_ALL_PAGE_SIZE : Number(v))}
            >
              <SelectTrigger className="h-8 w-18">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([10, 20, 50, 100, currentPageSize]))
                  .filter((size) => size !== DATA_TABLE_SHOW_ALL_PAGE_SIZE)
                  .sort((a, b) => a - b)
                  .map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                <SelectItem value="all">{t("allRows")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 text-xs">
              {t("pageOfTotal", { page: pageIndex + 1, totalPages: Math.max(1, table.getPageCount()) })}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
