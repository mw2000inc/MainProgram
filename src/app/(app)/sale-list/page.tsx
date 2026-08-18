"use client"

import * as React from "react"
import { ClipboardCheck, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { SaleListFormDialog } from "@/components/sale-list/sale-list-form-dialog"
import {
  getSaleListColumns,
  getSaleListRowClassName,
  SALE_LIST_EXPORT_COLUMNS,
  type SaleListRow,
} from "@/components/sale-list/sale-list-columns"
import { useDeleteSaleListEntries, useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useAuth } from "@/lib/auth/auth-context"

export default function SaleListPage() {
  const { user } = useAuth()
  const { data: entries = [], isPending: p1 } = useSaleListEntries()
  const { data: customers = [], isPending: p2 } = useCustomers()
  const deleteEntries = useDeleteSaleListEntries()

  const [formOpen, setFormOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<SaleListRow | undefined>(undefined)

  const isPending = p1 || p2

  const rows: SaleListRow[] = React.useMemo(
    () =>
      entries.map((e) => {
        const customer = customers.find((c) => c.id === e.customerId)
        const accountLabel = customer
          ? `${customer.memberAccountNumber ? customer.memberAccountNumber + " — " : ""}${customer.companyName || customer.fullName}`
          : ""
        return { ...e, accountLabel }
      }),
    [entries, customers]
  )

  const columns = React.useMemo(
    () =>
      getSaleListColumns({
        canDelete: user?.role === "admin",
        onDelete: (entry) => setDeleting(entry),
      }),
    [user?.role]
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" /> Sale List
          </h1>
          <p className="text-sm text-muted-foreground">Per-member install and care-plan coverage.</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={SALE_LIST_EXPORT_COLUMNS} rows={rows} fileName="sale-list" />
          <Button className="gap-1.5" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={rows}
            searchPlaceholder="Search by order number, account, product..."
            emptyMessage="No sale list entries found."
            getRowClassName={getSaleListRowClassName}
          />
        </CardContent>
      </Card>

      <SaleListFormDialog open={formOpen} onOpenChange={setFormOpen} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this sale list entry?"
        description="This will permanently remove this record."
        loading={deleteEntries.isPending}
        onConfirm={async () => {
          if (!deleting) return
          await deleteEntries.mutateAsync([deleting.id])
          setDeleting(undefined)
        }}
      />
    </div>
  )
}
