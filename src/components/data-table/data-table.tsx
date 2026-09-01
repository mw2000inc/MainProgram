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

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  searchPlaceholder?: string
  toolbar?: React.ReactNode
  onFilteredRowsChange?: (rows: TData[]) => void
  emptyMessage?: string
  pageSize?: number
  onRowClick?: (row: TData) => void
  // Extra className per row (e.g. strikethrough for completed/inactive entries).
  getRowClassName?: (row: TData) => string | undefined
  // Extra classes merged onto the scrolling table wrapper itself — e.g. the
  // Daily Report's Filter Change/Collection panels opt into
  // scrollbar-always-visible (see globals.css) so their wide, inline-
  // editable column set's horizontal scroll is obvious without a hover/
  // scroll gesture first. Every other call site leaves this unset and gets
  // the exact wrapper classes as before.
  tableContainerClassName?: string
  // Extra classes merged onto the actual <table> element (not its wrapper)
  // — e.g. an explicit min-w-[...] to guarantee the table itself is wide
  // enough to force tableContainerClassName's overflow-x-auto to actually
  // engage, regardless of how narrow any individual cell's own content
  // happens to be. Every other call site leaves this unset and gets the
  // plain w-full table as before.
  tableClassName?: string
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = "Search...",
  toolbar,
  onFilteredRowsChange,
  emptyMessage = "No records found.",
  pageSize = 10,
  onRowClick,
  getRowClassName,
  tableContainerClassName,
  tableClassName,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize })

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
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
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
          />
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>

      <div className={cn("min-h-0 flex-1 rounded-lg border overflow-x-auto overflow-y-auto", tableContainerClassName)}>
        <Table className={tableClassName}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sortDir = header.column.getIsSorted()
                  return (
                    <TableHead key={header.id}>
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
                <TableCell colSpan={columns.length} className="h-28 text-center text-muted-foreground">
                  {emptyMessage}
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
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>
          {totalRows > 0 ? `Showing ${startRow}-${endRow} of ${totalRows}` : "No results"}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(currentPageSize)}
              onValueChange={(v) => table.setPageSize(Number(v))}
            >
              <SelectTrigger className="h-8 w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([10, 20, 50, 100, currentPageSize]))
                  .sort((a, b) => a - b)
                  .map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
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
              Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
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
