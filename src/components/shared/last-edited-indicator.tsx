"use client"

import { useAuth } from "@/lib/auth/auth-context"
import { useLatestActivityForEntity } from "@/lib/hooks/use-activity-logs"
import { formatDateTime } from "@/lib/utils"

// "Last edited by X · date" for a single record — reads the most recent
// activity_logs entry for it (see the audit_logging migration's
// log_audit_event() trigger), so this is only ever what actually happened,
// never something a form could misrepresent. Admin-only, matching the
// Activity page itself: activity_logs' own RLS already returns nothing for
// a technician, but the isAdmin check here skips the request entirely
// rather than rendering nothing after a round trip.
export function LastEditedIndicator({ entityType, entityId, className }: { entityType: string; entityId: string | undefined; className?: string }) {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data } = useLatestActivityForEntity(entityType, isAdmin ? entityId : undefined)

  if (!isAdmin || !data) return null

  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      Last edited by <span className="font-medium text-foreground">{data.userName}</span> &middot;{" "}
      {formatDateTime(data.createdAt)}
    </p>
  )
}
