"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Pencil, QrCode, StickyNote, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { TruncatedCell, TruncatedContainer } from "@/components/shared/truncated-cell"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate } from "@/lib/utils"
import type { SaleListEntry } from "@/lib/types"

export type SaleListRow = SaleListEntry & {
  accountLabel: string
  // The linked customer's own "SK001-####" order_number, never rendered —
  // exists purely so DataTable's generic search can find an order by that
  // number too, not just this entry's own "001-####" orderNumber (see
  // sale-list/page.tsx's own row-building comment). Optional: this type is
  // also reused by other pages (Member List's Related Sales table, CP
  // System, the customer portal) that build their own accountLabel rows
  // without a search box to fix, so they don't need to populate it.
  customerOrderNumber?: string
}

function NoteCell({ entry }: { entry: SaleListRow }) {
  if (!entry.note) return <span className="text-muted-foreground">—</span>
  return (
    <TruncatedContainer text={entry.note}>
      <TranslatableText
        entityType="sale_list_entries"
        entityId={entry.id}
        fieldName="note"
        text={entry.note}
        className="truncate text-muted-foreground"
      />
    </TruncatedContainer>
  )
}

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

// The Related Sales_Lists Note column's icon, shown when the unit (Sale List
// order) has a note: opens the full note — wrapped, line breaks kept,
// scrolling when long. Clicks stay inside (never open the order's row).
function NoteButton({ note }: { note: string }) {
  const { t } = useTranslation("fields")
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={t("note")}
          aria-label={t("note")}
          onClick={(e) => e.stopPropagation()}
          data-testid="sale-note-button"
        >
          <StickyNote className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-3"
        onClick={(e) => e.stopPropagation()}
        data-testid="sale-note-popover"
      >
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("note")}</p>
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm">{note}</div>
      </PopoverContent>
    </Popover>
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
      cell: ({ row }) => <TruncatedCell value={row.original.accountLabel} />,
    },
    {
      accessorKey: "productNo",
      header: () => <ColumnHeader tKey="productNo" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.productNo} />,
    },
    {
      accessorKey: "sc",
      header: () => <ColumnHeader tKey="sc" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.sc} />,
    },
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
      cell: ({ row }) => <NoteCell entry={row.original} />,
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
    // Note right after S/C, in its own column clear of the action icons — only
    // for the admin-facing callers (the ones passing actions), never the
    // public scan page, since notes are internal.
    columns.push({
      accessorKey: "note",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      enableSorting: false,
      cell: ({ row }) => (row.original.note?.trim() ? <NoteButton note={row.original.note} /> : null),
    })
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
