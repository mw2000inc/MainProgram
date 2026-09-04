"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ColumnHeader } from "@/components/shared/column-header"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { CpSystem, CpSystemComponent } from "@/lib/types"

// Synthesized per-render from CpSystem.components (a plain jsonb array, no
// real per-row ids) — index-based id, only ever used to know which array
// position an Edit/Delete click applies to. Never persisted or compared
// across renders.
export type CpSystemComponentRow = CpSystemComponent & { id: string; status?: string }

function RowActionsCell({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation("common")
  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={t("edit")}
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
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
          title={t("delete")}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

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
      header: () => <ColumnHeader tKey="systemCode" ns="fields" />,
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.systemCode}</span>,
    },
    {
      id: "components",
      header: () => <ColumnHeader tKey="cpDetailsAll" ns="cpSystem" />,
      // Same "name - Xm" comma-joined shape as the old AppSheet free-text
      // column, just derived from the structured data instead of being the
      // source of truth itself. "x{quantity}" only when it's not the
      // implied default of 1 (also covers every component predating the
      // field, which has no quantity at all) — keeps the common case exactly
      // as compact as before this field existed.
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.components
            .map((c) => `${c.name}${c.quantity && c.quantity !== 1 ? ` x${c.quantity}` : ""} - ${c.intervalMonths}M`)
            .join(", ")}
        </span>
      ),
    },
  ]

  if (canEdit || canDelete) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <RowActionsCell
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={() => onEdit(row.original)}
          onDelete={() => onDelete(row.original)}
        />
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
      header: () => <ColumnHeader tKey="systemCode" ns="fields" />,
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.systemCode}</span>,
    },
  ]
}

// The "CP_SystemDetails" sub-table on a system's detail panel — one row per
// filter component: Filter (name), Quantity, Filter Term (interval).
// Edit/Delete operate on CpSystemComponentRow's synthesized index-based id
// (see above), not a real database row.
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
    { accessorKey: "name", header: () => <ColumnHeader tKey="filter" ns="fields" /> },
    {
      accessorKey: "quantity",
      header: () => <ColumnHeader tKey="quantity" ns="fields" />,
      // Every component predating this field has no quantity stored at all
      // — displayed as the implied default of 1, same fallback the form and
      // the parent list's summary string both use.
      cell: ({ row }) => row.original.quantity ?? 1,
    },
    {
      accessorKey: "intervalMonths",
      header: () => <ColumnHeader tKey="filterTerm" ns="cpSystem" />,
      cell: ({ row }) => `${row.original.intervalMonths}M`,
    },
  ]

  if (canEdit || canDelete) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <RowActionsCell
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={() => onEdit(row.original)}
          onDelete={() => onDelete(row.original)}
        />
      ),
    })
  }

  return columns
}
