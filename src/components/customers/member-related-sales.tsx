"use client"

import * as React from "react"
import { ClipboardCheck } from "lucide-react"
import { DashboardPlanPanel } from "@/components/dashboard/dashboard-plan-panel"
import { SaleListFormDialog } from "@/components/sale-list/sale-list-form-dialog"
import { CustomerQrDialog } from "@/components/customers/customer-qr-dialog"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { getSaleListSummaryColumns, type SaleListRow } from "@/components/sale-list/sale-list-columns"
import { isPrimaryOrderRow } from "@/lib/sale-list"
import { useDeleteSaleListEntries } from "@/lib/hooks/use-sale-list"
import type { Permission } from "@/lib/auth/auth-context"
import type { Customer } from "@/lib/types"

// A member's "Related Sales_Lists" table — the default (row-not-yet-opened)
// state of the Member detail panel's related-sales section. Clicking a row
// hands the pick up to the caller (`onSelectOrder`), which swaps the entire
// member panel for that order's own full detail view; the row's own Edit
// icon instead opens the Add/Edit dialog directly, bypassing that detail
// view — this component only ever renders the table + its own dialogs.
export function MemberRelatedSalesTable({
  customer,
  rows,
  can,
  onSelectOrder,
}: {
  customer: Customer
  rows: SaleListRow[]
  can: (permission: Permission) => boolean
  onSelectOrder: (row: SaleListRow) => void
}) {
  const [formOpen, setFormOpen] = React.useState(false)
  // Set by the row's own Edit icon — opens the same SaleListFormDialog as
  // "Add", but in edit mode for a real row, or create mode (via
  // defaultOrderNumber below) for the synthesized primary row.
  const [editingRow, setEditingRow] = React.useState<SaleListRow | undefined>(undefined)
  const [qrEntry, setQrEntry] = React.useState<SaleListRow | undefined>(undefined)
  // Set by the row's own Delete icon — never offered for the primary row
  // (see getSaleListSummaryColumns), so this is always a real row.
  const [deletingRow, setDeletingRow] = React.useState<SaleListRow | undefined>(undefined)
  const deleteEntries = useDeleteSaleListEntries()
  const columns = React.useMemo(
    () =>
      getSaleListSummaryColumns({
        onQrClick: setQrEntry,
        onEditClick: can("sales:edit") ? setEditingRow : undefined,
        onDeleteClick: can("sales:delete") ? setDeletingRow : undefined,
      }),
    [can]
  )
  const editingPrimary = editingRow ? isPrimaryOrderRow(editingRow.id) : false

  return (
    <>
      <DashboardPlanPanel
        title="Related Sales_Lists"
        icon={ClipboardCheck}
        columns={columns}
        data={rows}
        emptyMessage="No related sales for this member."
        canAdd={can("sales:add")}
        addLabel="Add"
        onAdd={() => setFormOpen(true)}
        onRowClick={onSelectOrder}
      />

      <SaleListFormDialog
        open={formOpen || !!editingRow}
        onOpenChange={(o) => {
          if (o) return
          setFormOpen(false)
          setEditingRow(undefined)
        }}
        entry={editingRow && !editingPrimary ? editingRow : undefined}
        defaultCustomerId={customer.id}
        defaultOrderNumber={editingPrimary ? editingRow!.orderNumber : undefined}
      />

      {/* Deep-links into this one order on the customer's scan page
          (?order=...) — same public/no-login QR dialog as the Member panel's
          own QR button, just scoped to a single sale-list order instead of
          the customer's own order number. */}
      <CustomerQrDialog
        open={!!qrEntry}
        onOpenChange={(o) => !o && setQrEntry(undefined)}
        customer={customer}
        orderNumber={qrEntry?.orderNumber}
      />

      <ConfirmDialog
        open={!!deletingRow}
        onOpenChange={(o) => !o && setDeletingRow(undefined)}
        title="Delete this sale list entry?"
        description="This will permanently remove this record."
        loading={deleteEntries.isPending}
        onConfirm={async () => {
          if (!deletingRow) return
          await deleteEntries.mutateAsync([deletingRow.id])
          setDeletingRow(undefined)
        }}
      />
    </>
  )
}
