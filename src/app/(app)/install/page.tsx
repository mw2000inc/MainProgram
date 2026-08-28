"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { HardHat, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { InstallFormDialog } from "@/components/install/install-form-dialog"
import { getInstallFullColumns, INSTALL_EXPORT_COLUMNS } from "@/components/install/install-columns"
import { useDeleteInstallPlans, useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { InstallPlan } from "@/lib/types"

function InstallPageContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data: plans = [], isPending } = useInstallPlans()
  const deletePlans = useDeleteInstallPlans()

  // Deep link from e.g. the Daily Report's Installation Plan panel
  // (?id=<planId>) — opens that record's detail panel directly.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<InstallPlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<InstallPlan | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<InstallPlan[]>(plans)

  const selection = useSplitViewSelection(filteredRows, initialId)
  useDeepLinkNotFoundToast(initialId, isPending, plans.some((p) => p.id === initialId))

  const columns = React.useMemo(
    () =>
      getInstallFullColumns({
        canDelete: isAdmin,
        onDelete: (plan) => setDeleting(plan),
      }),
    [isAdmin]
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const selected = selection.selected

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <HardHat className="h-6 w-6 text-primary" /> Install
          </h1>
          <p className="text-sm text-muted-foreground">Full list of scheduled and completed installations.</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={INSTALL_EXPORT_COLUMNS} rows={plans} fileName="install-plan" />
          <Button
            className="gap-1.5"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <SplitViewLayout
        isOpen={selection.isOpen}
        expanded={selection.expanded}
        list={
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={columns}
                data={plans}
                searchPlaceholder="Search by name, order no, address..."
                emptyMessage="No install plans found."
                onFilteredRowsChange={setFilteredRows}
                onRowClick={(row) => selection.open(row)}
              />
            </CardContent>
          </Card>
        }
        detail={
          selected && (
            <DetailPanel
              title={selected.name}
              icon={HardHat}
              subtitle={selected.orderNo}
              onEdit={
                isAdmin
                  ? () => {
                      setEditing(selected)
                      setFormOpen(true)
                    }
                  : undefined
              }
              onDelete={isAdmin ? () => setDeleting(selected) : undefined}
              onPrev={selection.prev}
              onNext={selection.next}
              hasPrev={selection.hasPrev}
              hasNext={selection.hasNext}
              expanded={selection.expanded}
              onToggleExpand={() => selection.setExpanded((v) => !v)}
              onClose={selection.close}
            >
              <DetailField label="Input Date" value={formatDate(selected.inputDate)} />
              <DetailField label="Order No" value={selected.orderNo} />
              <DetailField label="Name" value={selected.name} />
              <DetailField label="Address" value={selected.address} className="sm:col-span-2" />
              <DetailField label="Contact #" value={selected.contactNumber} />
              <DetailField label="In or Out" value={selected.inOut} />
              <DetailField label="Model" value={selected.model} />
              <DetailField label="Model(dp)" value={selected.modelDp} />
              <DetailField label="Unit Price" value={formatCurrency(selected.unitPrice)} />
              <DetailField label="C/P Price" value={formatCurrency(selected.cpPrice)} />
              <DetailField label="Delivery & Installation Fee" value={formatCurrency(selected.deliveryInstallationFee)} />
              <DetailField
                label="Pre Installed Date"
                value={selected.preInstalledDate ? formatDate(selected.preInstalledDate) : undefined}
              />
              <DetailField
                label="Installed Date"
                value={selected.installedDate ? formatDate(selected.installedDate) : undefined}
              />
              <DetailField label="Status" value={selected.status} />
              <DetailField label="Note" value={selected.note} className="sm:col-span-2" />
            </DetailPanel>
          )
        }
      />

      <InstallFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        defaultDate={new Date().toISOString().slice(0, 10)}
        plan={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this install plan?"
        description="This will permanently remove this install record."
        loading={deletePlans.isPending}
        onConfirm={async () => {
          if (!deleting) return
          const wasSelected = selected?.id === deleting.id
          await deletePlans.mutateAsync([deleting.id])
          setDeleting(undefined)
          if (wasSelected) selection.close()
        }}
      />
    </div>
  )
}

function InstallPageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function InstallPage() {
  return (
    <React.Suspense fallback={<InstallPageFallback />}>
      <InstallPageContent />
    </React.Suspense>
  )
}
