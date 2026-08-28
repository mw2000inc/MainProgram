"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Wrench, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { getRepairFullColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { useDeleteRepairPlans, useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { formatCurrency, formatDate, todayIso } from "@/lib/utils"
import type { RepairPlan } from "@/lib/types"

function RepairPlanPageContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data: plans = [], isPending } = useRepairPlans()
  const deletePlans = useDeleteRepairPlans()

  // Deep link from e.g. the Daily Report's Repair Plan panel (?id=<planId>)
  // — opens that record's detail panel directly.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<RepairPlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<RepairPlan | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<RepairPlan[]>(plans)

  const selection = useSplitViewSelection(filteredRows, initialId)
  useDeepLinkNotFoundToast(initialId, isPending, plans.some((p) => p.id === initialId))

  const columns = React.useMemo(
    () =>
      getRepairFullColumns({
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
            <Wrench className="h-6 w-6 text-primary" /> Repair Plan
          </h1>
          <p className="text-sm text-muted-foreground">Full list of repair requests and their status.</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={REPAIR_EXPORT_COLUMNS} rows={plans} fileName="repair-plan" />
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
                searchPlaceholder="Search by account name, order no, problem..."
                emptyMessage="No repair plans found."
                onFilteredRowsChange={setFilteredRows}
                onRowClick={(row) => selection.open(row)}
              />
            </CardContent>
          </Card>
        }
        detail={
          selected && (
            <DetailPanel
              title={selected.accountName}
              icon={Wrench}
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
              <DetailField label="Issued Date" value={formatDate(selected.issuedDate)} />
              <DetailField label="Order No" value={selected.orderNo} />
              <DetailField label="Account Name" value={selected.accountName} />
              <DetailField label="Unit IN/OUT" value={selected.unitInOut} />
              <DetailField label="Problem" value={selected.problem} className="sm:col-span-2" />
              <DetailField label="Solution / Status" value={selected.solutionStatus} className="sm:col-span-2" />
              <DetailField label="Pre D" value={selected.preD ? formatDate(selected.preD) : undefined} />
              <DetailField label="Acc D" value={selected.accD ? formatDate(selected.accD) : undefined} />
              <DetailField label="TH" value={selected.th} />
              <DetailField label="Part No" value={selected.partNo} />
              <DetailField label="AMT" value={formatCurrency(selected.amt)} />
              <DetailField label="Status" value={selected.status} />
            </DetailPanel>
          )
        }
      />

      <RepairFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        defaultDate={todayIso()}
        plan={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this repair plan?"
        description="This will permanently remove this repair record."
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

function RepairPlanPageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function RepairPlanPage() {
  return (
    <React.Suspense fallback={<RepairPlanPageFallback />}>
      <RepairPlanPageContent />
    </React.Suspense>
  )
}
