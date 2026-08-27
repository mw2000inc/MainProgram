"use client"

import * as React from "react"
import { History } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { AdminGuard } from "@/components/shared/admin-guard"
import { getActivityColumns } from "@/components/activity/activity-columns"
import { ActivityDetailDialog } from "@/components/activity/activity-detail-dialog"
import { useActivityLogs } from "@/lib/hooks/use-activity-logs"
import type { ActivityLogEntry } from "@/lib/types"

export default function ActivityPage() {
  const { data: entries = [], isPending } = useActivityLogs()
  const [selected, setSelected] = React.useState<ActivityLogEntry | undefined>(undefined)
  const columns = React.useMemo(() => getActivityColumns(), [])

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <AdminGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-primary" /> Admin Activity
          </h1>
          <p className="text-sm text-muted-foreground">
            Who changed what, and when — recorded automatically for every admin action.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={columns}
              data={entries}
              searchPlaceholder="Search by admin or record..."
              emptyMessage="No activity recorded yet."
              onRowClick={(row) => setSelected(row)}
            />
          </CardContent>
        </Card>

        <ActivityDetailDialog entry={selected} onOpenChange={(open) => !open && setSelected(undefined)} />
      </div>
    </AdminGuard>
  )
}
