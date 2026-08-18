"use client"

import * as React from "react"
import { Droplets, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { FilterChangeFormDialog } from "@/components/filter-change/filter-change-form-dialog"
import { getFilterChangeFullColumns, FILTER_CHANGE_EXPORT_COLUMNS } from "@/components/filter-change/filter-change-columns"
import { useDeleteFilterChangePlans, useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useAuth } from "@/lib/auth/auth-context"
import { cn } from "@/lib/utils"
import type { FilterChangePlan } from "@/lib/types"

function yearMonth(dateStr: string) {
  return dateStr.slice(0, 7)
}

export default function FilterChangePage() {
  const { user } = useAuth()
  const { data: plans = [], isPending } = useFilterChangePlans()
  const deletePlans = useDeleteFilterChangePlans()

  const [selectedMonth, setSelectedMonth] = React.useState<string>("all")
  const [formOpen, setFormOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<FilterChangePlan | undefined>(undefined)

  const monthGroups = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of plans) {
      const ym = yearMonth(p.planDate)
      counts.set(ym, (counts.get(ym) ?? 0) + 1)
    }
    return Array.from(counts, ([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month))
  }, [plans])

  const scopedPlans = React.useMemo(() => {
    if (selectedMonth === "all") return plans
    return plans.filter((p) => yearMonth(p.planDate) === selectedMonth)
  }, [plans, selectedMonth])

  const columns = React.useMemo(
    () =>
      getFilterChangeFullColumns({
        canDelete: user?.role === "admin",
        onDelete: (p) => setDeleting(p),
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
            <Droplets className="h-6 w-6 text-primary" /> Filter Change
          </h1>
          <p className="text-sm text-muted-foreground">Full list of filter change plans, grouped by month.</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={FILTER_CHANGE_EXPORT_COLUMNS} rows={scopedPlans} fileName="filter-change" />
          <Button className="gap-1.5" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4 items-start">
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[70vh] overflow-y-auto divide-y">
              <button
                onClick={() => setSelectedMonth("all")}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors",
                  selectedMonth === "all" && "bg-accent font-medium"
                )}
              >
                All
              </button>
              {monthGroups.map((g) => (
                <button
                  key={g.month}
                  onClick={() => setSelectedMonth(g.month)}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors",
                    selectedMonth === g.month && "bg-accent font-medium"
                  )}
                >
                  <span>{g.month}</span>
                  <Badge variant="secondary" className="ml-2">
                    {g.count}
                  </Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={columns}
              data={scopedPlans}
              searchPlaceholder="Search by order number, account, address..."
              emptyMessage="No filter change plans found."
              getRowClassName={(p) => (p.status.toLowerCase() !== "pending" ? "line-through text-muted-foreground" : undefined)}
            />
          </CardContent>
        </Card>
      </div>

      <FilterChangeFormDialog open={formOpen} onOpenChange={setFormOpen} defaultDate={new Date().toISOString().slice(0, 10)} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this filter change plan?"
        description="This will permanently remove this filter change record."
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
