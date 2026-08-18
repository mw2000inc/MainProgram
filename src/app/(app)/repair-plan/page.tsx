"use client"

import * as React from "react"
import { Wrench, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { getRepairFullColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { useDeleteRepairPlans, useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useAuth } from "@/lib/auth/auth-context"
import type { RepairPlan } from "@/lib/types"

export default function RepairPlanPage() {
  const { user } = useAuth()
  const { data: plans = [], isPending } = useRepairPlans()
  const deletePlans = useDeleteRepairPlans()

  const [formOpen, setFormOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<RepairPlan | undefined>(undefined)

  const columns = React.useMemo(
    () =>
      getRepairFullColumns({
        canDelete: user?.role === "admin",
        onDelete: (plan) => setDeleting(plan),
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
            <Wrench className="h-6 w-6 text-primary" /> Repair Plan
          </h1>
          <p className="text-sm text-muted-foreground">Full list of repair requests and their status.</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={REPAIR_EXPORT_COLUMNS} rows={plans} fileName="repair-plan" />
          <Button className="gap-1.5" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={plans}
            searchPlaceholder="Search by account name, order no, problem..."
            emptyMessage="No repair plans found."
          />
        </CardContent>
      </Card>

      <RepairFormDialog open={formOpen} onOpenChange={setFormOpen} defaultDate={new Date().toISOString().slice(0, 10)} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this repair plan?"
        description="This will permanently remove this repair record."
        loading={deletePlans.isPending}
        onConfirm={async () => {
          if (!deleting) return
          await deletePlans.mutateAsync([deleting.id])
          setDeleting(undefined)
        }}
      />
    </div>
  )
}
