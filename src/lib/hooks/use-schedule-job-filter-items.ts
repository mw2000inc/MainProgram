import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/schedule-job-filter-items"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { stockMovementsKey } from "@/lib/hooks/use-inventory"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"

export function useScheduleJobFilterItems(scheduleJobId: string | undefined) {
  return useQuery({
    queryKey: ["scheduleJobFilterItems", scheduleJobId],
    queryFn: () => api.listScheduleJobFilterItems(scheduleJobId as string),
    enabled: !!scheduleJobId,
  })
}

// Recording a job's required filters cascades, server-side, into that job's
// Filter Change/Collection records and a pending stock movement per item
// (see the ct_filter_change_collection_inventory_link migration) — so a
// successful call here means all four of those need refetching, not just
// this list itself.
export function useCreateScheduleJobFilterItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ scheduleJobId, items }: { scheduleJobId: string; items: { productId: string; quantity: number }[] }) =>
      api.createScheduleJobFilterItems(scheduleJobId, items),
    onSuccess: (_data, { scheduleJobId }) => {
      qc.invalidateQueries({ queryKey: ["scheduleJobFilterItems", scheduleJobId] })
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      qc.invalidateQueries({ queryKey: collectionsKey })
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
    },
  })
}
