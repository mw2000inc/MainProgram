"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CpSystem, CpSystemComponent } from "@/lib/types"

// Synthesized per-render from CpSystem.components (a plain jsonb array, no
// real per-row ids) — index-based id, only ever used to know which array
// position an Edit/Delete click applies to. Never persisted or compared
// across renders.
export type CpSystemComponentRow = CpSystemComponent & { id: string; status?: string }

export function getCpSystemColumns({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: (system: CpSystem) => void
  onDelete: (system: CpSystem) => void
}): ColumnDef<CpSystem, unknown>[] {
  const columns: ColumnDef<CpSystem, unknown>[] = [
    {
      accessorKey: "systemCode",
      header: "System Code",
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.systemCode}</span>,
    },
    {
      id: "components",
      header: "CP_details_all",
      // Same "name - Xm" comma-joined shape as the old AppSheet free-text
      // column, just derived from the structured data instead of being the
      // source of truth itself.
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.components.map((c) => `${c.name} - ${c.intervalMonths}M`).join(", ")}
        </span>
      ),
    },
  ]

  if (canEdit || canDelete) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(row.original)
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-danger hover:text-danger"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(row.original)
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    })
  }

  return columns
}

// Single "System Code" column for the split-view's narrow list once a system
// is open — matches getSaleListOrderNumberColumn's role for Sale List.
export function getCpSystemNarrowColumn(): ColumnDef<CpSystem, unknown>[] {
  return [
    {
      accessorKey: "systemCode",
      header: "System Code",
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.systemCode}</span>,
    },
  ]
}

// The "CP_SystemDetails" sub-table on a system's detail panel — one row per
// filter component, Filter (name) + Filter Term (interval). Edit/Delete
// operate on CpSystemComponentRow's synthesized index-based id (see above),
// not a real database row.
export function getCpSystemDetailColumns({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: (row: CpSystemComponentRow) => void
  onDelete: (row: CpSystemComponentRow) => void
}): ColumnDef<CpSystemComponentRow, unknown>[] {
  const columns: ColumnDef<CpSystemComponentRow, unknown>[] = [
    { accessorKey: "name", header: "Filter" },
    {
      accessorKey: "intervalMonths",
      header: "Filter Term",
      cell: ({ row }) => `${row.original.intervalMonths}M`,
    },
  ]

  if (canEdit || canDelete) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(row.original)
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-danger hover:text-danger"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(row.original)
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    })
  }

  return columns
}
