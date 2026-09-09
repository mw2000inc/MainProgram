"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatusBadge } from "@/components/shared/status-badge"
import { ActivityDateFilter } from "@/components/activity/activity-date-filter"
import { ActivityDetailDialog } from "@/components/activity/activity-detail-dialog"
import { actionLabel, entityTypeLabel } from "@/lib/activity-log-config"
import { groupIntoEvents, useDispatchRecordIndex } from "@/components/dashboard/dispatch-history-dialog"
import { useDispatchNotifications } from "@/lib/hooks/use-dispatch-confirmation"
import { useActivityLogs } from "@/lib/hooks/use-activity-logs"
import { useUsers } from "@/lib/hooks/use-misc"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDateTime, todayIso } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"
import type { DispatchEntityType } from "@/lib/api/dispatch-confirmation"

// The 4 tables this whole Admin Approval workflow spans — same set
// PendingApprovalsPanel/DispatchHistoryDialog already cover. activity_logs
// carries plenty of other entity types (customers, products, settings,
// ...); this view only ever needs these four.
const APPROVAL_ENTITY_TYPES: ReadonlySet<DispatchEntityType> = new Set([
  "filter_change_plans",
  "install_plans",
  "collections",
  "repair_plans",
])

// "Who approved what, and who edited what, on a given day" — two existing,
// already-admin-gated data sources side by side, filtered to one calendar
// day: dispatch_notifications (via the exact same groupIntoEvents/
// useDispatchRecordIndex DispatchHistoryDialog itself uses, just narrowed
// to one day client-side, since that table is never large enough to
// justify a server-side day filter) for approvals, and activity_logs (via
// the existing useActivityLogs(date) — already a server-side UTC-day
// filter, same one the Admin Activity page uses) for edits, narrowed to
// just these 4 tables. Neither is a new table, trigger, or RPC.
export function PendingApprovalsHistoryDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The Daily Report's own selected report date, when opened from there —
  // "that day" means the day the report is showing, not necessarily
  // calendar-today. Falls back to today when opened from the Schedule
  // page's own Pending Approvals tab, which has no such concept.
  defaultDate?: string
}) {
  const { t } = useTranslation("dispatch")
  const { t: tActivity } = useTranslation("activity")
  const { t: tCommon } = useTranslation("common")
  // Read once, on mount, rather than synced via an effect — the parent
  // (PendingApprovalsPanel) remounts this component with a fresh `key` each
  // time it's opened (same pattern ApprovalDetailDialog's own row prop
  // already uses), so a prior session's manually-picked date (e.g.
  // browsing last Tuesday's edits) never silently persists into the next
  // time this is reopened for today.
  const [date, setDate] = React.useState<string | undefined>(() => defaultDate ?? todayIso())
  const [viewingEntry, setViewingEntry] = React.useState<ActivityLogEntry | undefined>(undefined)

  const { data: users = [] } = useUsers()
  const { data: notifications = [], isPending: approvalsPending } = useDispatchNotifications()
  const { data: activityLogs = [], isPending: editsPending } = useActivityLogs(date)
  const recordIndex = useDispatchRecordIndex()

  const userNameById = React.useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])

  const approvalEvents = React.useMemo(() => {
    const events = groupIntoEvents(notifications)
    if (!date) return events
    return events.filter((e) => e.createdAt.slice(0, 10) === date)
  }, [notifications, date])

  const editEntries = React.useMemo(
    () => activityLogs.filter((e) => e.entityType && APPROVAL_ENTITY_TYPES.has(e.entityType as DispatchEntityType)),
    [activityLogs]
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center justify-between gap-3 pr-6">
              <span>{t("approvalsHistoryTitle")}</span>
              <ActivityDateFilter value={date} onChange={setDate} />
            </DialogTitle>
            <DialogDescription>{t("approvalsHistoryDescription")}</DialogDescription>
          </DialogHeader>

          {/* Side by side on a wide dialog (this is now sm:max-w-3xl, wide
              enough to give each column real room) — stacks back to one
              column on narrow screens. Both lists are otherwise completely
              independent (different data sources, different empty states),
              so a grid is a purely visual pairing, not a shared layout. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2 min-w-0">
              <h3 className="text-sm font-medium">{t("approvedSectionTitle", { count: String(approvalEvents.length) })}</h3>
              {approvalsPending ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{tCommon("loading")}</p>
              ) : approvalEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("noApprovalsOnDate")}</p>
              ) : (
                <div className="space-y-2">
                  {approvalEvents.map((event) => {
                    const info = recordIndex.get(`${event.entityType}:${event.entityId}`)
                    const approverName = event.createdBy ? userNameById.get(event.createdBy) : undefined
                    return (
                      <div key={event.key} className="rounded-md border p-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="secondary" label={info ? t(info.moduleLabel) : t("unknown")} />
                          <span className="font-medium truncate">{info?.recordLabel ?? t("recordNoLongerAvailable")}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("approvedBy", { name: approverName ?? t("unknown") })} · {formatDateTime(event.createdAt)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2 min-w-0 sm:border-l sm:pl-5 border-t sm:border-t-0 pt-4 sm:pt-0">
              <h3 className="text-sm font-medium">{t("editedSectionTitle", { count: String(editEntries.length) })}</h3>
              {editsPending ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{tCommon("loading")}</p>
              ) : editEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t("noEditsOnDate")}</p>
              ) : (
                <div className="space-y-2">
                  {editEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="w-full rounded-md border p-2.5 text-sm text-left hover:bg-muted/50 transition-colors"
                      onClick={() => setViewingEntry(entry)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium truncate">{entry.userName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatDateTime(entry.createdAt)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 wrap-break-word">
                        {actionLabel(entry.action, tActivity)} {entityTypeLabel(entry.entityType, tActivity)}
                        {entry.description ? ` — ${entry.description}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ActivityDetailDialog entry={viewingEntry} onOpenChange={(next) => !next && setViewingEntry(undefined)} />
    </>
  )
}
