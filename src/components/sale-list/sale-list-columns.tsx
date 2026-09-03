"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Pencil, QrCode, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ColumnHeader } from "@/components/shared/column-header"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate } from "@/lib/utils"
import type { SaleListEntry } from "@/lib/types"

export type SaleListRow = SaleListEntry & { accountLabel: string }

export function StatusCell({ status }: { status: SaleListEntry["status"] }) {
  const { t } = useTranslation("status")
  if (status === "RENT") {
    return (
      <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning font-medium">
        {t("rent")}
      </Badge>
    )
  }
  if (status === "DIY") {
    return (
      <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary font-medium">
        {t("diy")}
      </Badge>
    )
  }
  if (status === "INACTIVE") {
    return (
      <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
        {t("inactive")}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-success/20 bg-success/10 text-success font-medium">
      {t("active")}
    </Badge>
  )
}

function ActionsCell({
  entry,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  entry: SaleListRow
  canEdit: boolean
  canDelete: boolean
  onEdit: (entry: SaleListRow) => void
  onDelete: (entry: SaleListRow) => void
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
            onEdit(entry)
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
            onDelete(entry)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

function SummaryActionsCell({
  entry,
  onQrClick,
  onEditClick,
  onDeleteClick,
}: {
  entry: SaleListRow
  onQrClick?: (entry: SaleListRow) => void
  onEditClick?: (entry: SaleListRow) => void
  onDeleteClick?: (entry: SaleListRow) => void
}) {
  const { t } = useTranslation("common")
  return (
    <div className="flex items-center justify-end gap-1">
      {onEditClick && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={t("edit")}
          onClick={(e) => {
            e.stopPropagation()
            onEditClick(entry)
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {onQrClick && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={t("qrCode")}
          onClick={(e) => {
            e.stopPropagation()
            onQrClick(entry)
          }}
        >
          <QrCode className="h-3.5 w-3.5" />
        </Button>
      )}
      {onDeleteClick && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-danger hover:text-danger"
          title={t("delete")}
          onClick={(e) => {
            e.stopPropagation()
            onDeleteClick(entry)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

// Matches the old AppSheet "MW CP > Sales List" screen's column layout —
// the plain full-width table, with per-row Edit/Delete actions since there's
// no side detail panel here to reach them from otherwise.
export function getSaleListColumns({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: (entry: SaleListRow) => void
  onDelete: (entry: SaleListRow) => void
}): ColumnDef<SaleListRow, unknown>[] {
  const columns: ColumnDef<SaleListRow, unknown>[] = [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "installedDate",
      header: () => <ColumnHeader tKey="installedDate" ns="fields" />,
      cell: ({ row }) => (row.original.installedDate ? formatDate(row.original.installedDate) : "—"),
    },
    {
      accessorKey: "accountLabel",
      header: () => <ColumnHeader tKey="account" ns="fields" />,
      cell: ({ row }) => row.original.accountLabel || "—",
    },
    { accessorKey: "productNo", header: () => <ColumnHeader tKey="productNo" ns="fields" /> },
    { accessorKey: "sc", header: () => <ColumnHeader tKey="sc" ns="fields" /> },
    { accessorKey: "cf", header: () => <ColumnHeader tKey="cf" ns="fields" /> },
    { accessorKey: "ct", header: () => <ColumnHeader tKey="ct" ns="fields" /> },
    { accessorKey: "cpY1Y2", header: () => <ColumnHeader tKey="cpY1Y2" ns="fields" /> },
    {
      accessorKey: "cpStart",
      header: () => <ColumnHeader tKey="cpStart" ns="fields" />,
      cell: ({ row }) => (row.original.cpStart ? formatDate(row.original.cpStart) : "—"),
    },
    {
      accessorKey: "cpEnd",
      header: () => <ColumnHeader tKey="cpEnd" ns="fields" />,
      cell: ({ row }) => (row.original.cpEnd ? formatDate(row.original.cpEnd) : "—"),
    },
    {
      accessorKey: "note",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.note || "—"}</span>,
    },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <StatusCell status={row.original.status} />,
    },
  ]

  if (canEdit || canDelete) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <ActionsCell entry={row.original} canEdit={canEdit} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} />
      ),
    })
  }

  return columns
}

// Single "Order Number" column for the Sale List page's narrow list once an
// order is open — a slim record picker next to the detail panel, so the
// admin can keep clicking through other orders without leaving that view.
export function getSaleListOrderNumberColumn(): ColumnDef<SaleListRow, unknown>[] {
  return [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
  ]
}

// Compact 5-column set matching the AppSheet "MW CP > Sales List" reference —
// used for a member's inline "Related Sales_Lists" table, which only
// surfaces the identifying columns, not the full care-plan detail. Also
// reused as-is (no `onQrClick`/`onEditClick`/`onDeleteClick`) by the
// public/read-only scan page's own Orders tab, so those action buttons only
// appear when explicitly requested by an admin-facing caller.
export function getSaleListSummaryColumns({
  onQrClick,
  onEditClick,
  onDeleteClick,
}: {
  onQrClick?: (entry: SaleListRow) => void
  onEditClick?: (entry: SaleListRow) => void
  onDeleteClick?: (entry: SaleListRow) => void
} = {}): ColumnDef<SaleListRow, unknown>[] {
  const columns: ColumnDef<SaleListRow, unknown>[] = [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "installedDate",
      header: () => <ColumnHeader tKey="installedDate" ns="fields" />,
      cell: ({ row }) => (row.original.installedDate ? formatDate(row.original.installedDate) : "—"),
    },
    {
      accessorKey: "accountLabel",
      header: () => <ColumnHeader tKey="account" ns="fields" />,
      cell: ({ row }) => row.original.accountLabel || "—",
    },
    { accessorKey: "productNo", header: () => <ColumnHeader tKey="productNo" ns="fields" /> },
    { accessorKey: "sc", header: () => <ColumnHeader tKey="sc" ns="fields" /> },
  ]

  if (onEditClick || onQrClick || onDeleteClick) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <SummaryActionsCell entry={row.original} onQrClick={onQrClick} onEditClick={onEditClick} onDeleteClick={onDeleteClick} />
      ),
    })
  }

  return columns
}

// INACTIVE renders strikethrough; RENT is highlighted (via StatusCell) but not
// struck — matches the AppSheet reference's two distinct visual treatments.
export function getSaleListRowClassName(entry: SaleListRow) {
  return cn(entry.status === "INACTIVE" && "line-through text-muted-foreground")
}

// Print/export column headers stay in English regardless of interface
// language — deferred to the long-tail phase alongside the other modules'
// export column arrays (see the phased i18n plan).
export const SALE_LIST_EXPORT_COLUMNS = [
  { header: "Order Number", key: "orderNumber" },
  { header: "Installed Date", key: "installedDate" },
  { header: "Account#", key: "accountLabel" },
  { header: "Product#", key: "productNo" },
  { header: "S/C", key: "sc" },
  { header: "C/F", key: "cf" },
  { header: "C/T", key: "ct" },
  { header: "CP y1/y2", key: "cpY1Y2" },
  { header: "CP start", key: "cpStart" },
  { header: "CP end", key: "cpEnd" },
  { header: "Note", key: "note" },
  { header: "Status", key: "status" },
]
