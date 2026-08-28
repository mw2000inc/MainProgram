"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { LucideIcon } from "lucide-react"
import type { UseQueryResult } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { AdminGuard } from "@/components/shared/admin-guard"
import { ActivityDateFilter } from "@/components/activity/activity-date-filter"
import { getActivityColumns } from "@/components/activity/activity-columns"
import { ActivityDetailDialog } from "@/components/activity/activity-detail-dialog"
import { resolveActivityLogTarget } from "@/lib/activity-log-navigation"
import type { ActivityLogEntry } from "@/lib/types"

// Shared by the Admin Activity and Technician Activity pages — same table,
// detail dialog, and date filter, just a different data source (which role's
// actions to show) and labels. Both are admin-only (AdminGuard) per the same
// activity_logs_select_admin RLS policy that already restricts the
// underlying table.
export function ActivityLogView({
  title,
  description,
  icon: Icon,
  actorLabel,
  searchPlaceholder,
  emptyMessage,
  useLogs,
}: {
  title: string
  description: string
  icon: LucideIcon
  actorLabel: string
  searchPlaceholder: string
  emptyMessage: string
  useLogs: (date: string | undefined) => UseQueryResult<ActivityLogEntry[]>
}) {
  const router = useRouter()
  const [date, setDate] = React.useState<string | undefined>(undefined)
  const { data: entries = [], isPending } = useLogs(date)
  const [selected, setSelected] = React.useState<ActivityLogEntry | undefined>(undefined)

  // A row navigates to that record's own page/view — see
  // resolveActivityLogTarget for the entity_type → route mapping. The
  // destination itself (a dynamic [id] page's "not found" state, or a list
  // page's own `?id=` deep-link handling) is what reports back if the
  // record was since deleted; this only decides where to send the click,
  // or shows a toast immediately for the handful of entity types that were
  // never navigable at all (e.g. suppliers, which have no page of their
  // own — checked against the codebase, not guessed).
  function handleRowClick(entry: ActivityLogEntry) {
    const target = resolveActivityLogTarget(entry)
    if (!target) {
      toast.error("No page is mapped for this record type yet.")
      return
    }
    if (target.kind === "unavailable") {
      toast.error(target.message)
      return
    }
    router.push(target.href)
  }

  const columns = React.useMemo(() => getActivityColumns(actorLabel, setSelected), [actorLabel])

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Icon className="h-6 w-6 text-primary" /> {title}
            </h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <ActivityDateFilter value={date} onChange={setDate} />
        </div>

        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={columns}
              data={entries}
              searchPlaceholder={searchPlaceholder}
              emptyMessage={date ? "No activity recorded for this date." : emptyMessage}
              onRowClick={handleRowClick}
            />
          </CardContent>
        </Card>

        <ActivityDetailDialog entry={selected} onOpenChange={(open) => !open && setSelected(undefined)} />
      </div>
    </AdminGuard>
  )
}
