import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import * as api from "@/lib/api/daily-report-sections"
import type { DailyReportSectionConfig, DailyReportSectionKey } from "@/lib/types"

export const dailyReportSectionsKey = ["dailyReportSections"] as const

// Shared config, not per-admin — every authenticated user (admin or
// technician) fetches this so their Daily Report reflects the admin's
// current configuration.
export function useDailyReportSections() {
  return useQuery({ queryKey: dailyReportSectionsKey, queryFn: api.listDailyReportSections })
}

export function useUpdateDailyReportSection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      sectionKey,
      input,
    }: {
      sectionKey: DailyReportSectionKey
      input: Partial<Omit<DailyReportSectionConfig, "sectionKey">>
    }) => api.updateDailyReportSection(sectionKey, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: dailyReportSectionsKey }),
    onError: () => toast.error("Failed to update section"),
  })
}

export function useReorderDailyReportSections() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order: DailyReportSectionKey[]) => api.reorderDailyReportSections(order),
    onSuccess: () => qc.invalidateQueries({ queryKey: dailyReportSectionsKey }),
    onError: () => toast.error("Failed to reorder sections"),
  })
}
