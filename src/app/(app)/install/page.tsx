"use client"

import * as React from "react"
import { HardHat, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { InstallFormDialog } from "@/components/install/install-form-dialog"
import { getInstallFullColumns, INSTALL_EXPORT_COLUMNS } from "@/components/install/install-columns"
import { useDeleteInstallPlans, useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useAuth } from "@/lib/auth/auth-context"
import type { InstallPlan } from "@/lib/types"

export default function InstallPage() {
  const { user } = useAuth()
  const { data: plans = [], isPending } = useInstallPlans()
  const deletePlans = useDeleteInstallPlans()

  const [formOpen, setFormOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<InstallPlan | undefined>(undefined)

  const columns = React.useMemo(
    () =>
      getInstallFullColumns({
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
            <HardHat className="h-6 w-6 text-primary" /> Install
          </h1>
          <p className="text-sm text-muted-foreground">Full list of scheduled and completed installations.</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={INSTALL_EXPORT_COLUMNS} rows={plans} fileName="install-plan" />
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
            searchPlaceholder="Search by name, order no, address..."
            emptyMessage="No install plans found."
          />
        </CardContent>
      </Card>

      <InstallFormDialog open={formOpen} onOpenChange={setFormOpen} defaultDate={new Date().toISOString().slice(0, 10)} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this install plan?"
        description="This will permanently remove this install record."
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
