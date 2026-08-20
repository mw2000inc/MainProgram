"use client"

import * as React from "react"
import { ClipboardCheck } from "lucide-react"
import { DashboardPlanPanel } from "@/components/dashboard/dashboard-plan-panel"
import { SaleListFormDialog } from "@/components/sale-list/sale-list-form-dialog"
import { getSaleListSummaryColumns, type SaleListRow } from "@/components/sale-list/sale-list-columns"
import type { Permission } from "@/lib/auth/auth-context"
import type { Customer } from "@/lib/types"

// A member's "Related Sales_Lists" table — the default (row-not-yet-opened)
// state of the Member detail panel's related-sales section. Clicking a row
// hands the pick up to the caller (`onSelectOrder`), which swaps the entire
// member panel for that order's own full detail view — this component only
// ever renders the table + its own "Add" dialog, nothing else.
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
  const columns = React.useMemo(() => getSaleListSummaryColumns(), [])

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

      <SaleListFormDialog open={formOpen} onOpenChange={setFormOpen} defaultCustomerId={customer.id} />
    </>
  )
}
