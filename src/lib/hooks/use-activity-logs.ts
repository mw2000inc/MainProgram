import { useQuery } from "@tanstack/react-query"
import * as api from "@/lib/api/activity-logs"
import { activityLogsKey } from "@/lib/hooks/use-misc"

// Reuses the activityLogsKey already exported (and already invalidated
// after customer/user/product/settings/etc. mutations — see the various
// src/lib/hooks/use-*.ts files) from use-misc.ts, so this list refetches
// automatically right after any of those actions succeed. date is an
// optional yyyy-MM-dd filter from the page's mini calendar.
export function useActivityLogs(date?: string) {
  return useQuery({
    queryKey: [...activityLogsKey, "admin", date ?? "all"],
    queryFn: () => api.listActivityLogs(date),
  })
}

// Same underlying activity_logs table as useActivityLogs, filtered to
// technician-authored entries — see the Technician Activity page.
export function useTechnicianActivityLogs(date?: string) {
  return useQuery({
    queryKey: [...activityLogsKey, "technician", date ?? "all"],
    queryFn: () => api.listTechnicianActivityLogs(date),
  })
}

export function useLatestActivityForEntity(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: [...activityLogsKey, "entity", entityType, entityId],
    queryFn: () => api.getLatestActivityForEntity(entityType, entityId as string),
    enabled: !!entityId,
  })
}
