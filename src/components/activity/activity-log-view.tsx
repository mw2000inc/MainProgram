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
import { DeletedRecordDialog } from "@/components/activity/deleted-record-dialog"
import { resolveActivityLogTarget } from "@/lib/activity-log-navigation"
import { useTranslation } from "@/lib/i18n/i18n-context"
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
  const { t } = useTranslation("activity")
  const [date, setDate] = React.useState<string | undefined>(undefined)
  const { data: entries = [], isPending } = useLogs(date)
  const [selected, setSelected] = React.useState<ActivityLogEntry | undefined>(undefined)
  const [deletedEntry, setDeletedEntry] = React.useState<ActivityLogEntry | undefined>(undefined)

  // A row navigates to that record's own page/view — see
  // resolveActivityLogTarget for the entity_type → route mapping. The
  // destination itself (a dynamic [id] page's "not found" state, or a list
  // page's own `?id=` deep-link handling) is what reports back if an
  // insert/update-logged record was since deleted; this only decides where
  // to send the click, or shows a toast immediately for the handful of
  // entity types that were never navigable at all (e.g. suppliers, which
  // have no page of their own — checked against the codebase, not guessed).
  //
  // A delete-action row is different: the record is *definitely* gone (that's
  // what this log entry recorded), so there's no page to navigate to at all —
  // clicking it opens a historical-snapshot dialog built from log.oldValues
  // instead of attempting a navigation that could only ever land on a
  // not-found state.
  function handleRowClick(entry: ActivityLogEntry) {
    if (entry.action === "delete") {
      setDeletedEntry(entry)
      return
    }
    const target = resolveActivityLogTarget(entry)
    if (!target) {
      toast.error(t("noPageMappedYet"))
      return
    }
    if (target.kind === "unavailable") {
      toast.error(t(target.messageKey))
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
              emptyMessage={date ? t("noActivityForDate") : emptyMessage}
              onRowClick={handleRowClick}
            />
          </CardContent>
        </Card>

        <ActivityDetailDialog entry={selected} onOpenChange={(open) => !open && setSelected(undefined)} />
        <DeletedRecordDialog entry={deletedEntry} onOpenChange={(open) => !open && setDeletedEntry(undefined)} />
      </div>
    </AdminGuard>
  )
}
