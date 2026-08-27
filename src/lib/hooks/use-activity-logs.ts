import { useQuery } from "@tanstack/react-query"
import * as api from "@/lib/api/activity-logs"
import { activityLogsKey } from "@/lib/hooks/use-misc"

// Reuses the activityLogsKey already exported (and already invalidated
// after customer/user/product/settings/etc. mutations — see the various
// src/lib/hooks/use-*.ts files) from use-misc.ts, so this list refetches
// automatically right after any of those actions succeed.
export function useActivityLogs() {
  return useQuery({ queryKey: activityLogsKey, queryFn: api.listActivityLogs })
}

export function useLatestActivityForEntity(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: [...activityLogsKey, "entity", entityType, entityId],
    queryFn: () => api.getLatestActivityForEntity(entityType, entityId as string),
    enabled: !!entityId,
  })
}
