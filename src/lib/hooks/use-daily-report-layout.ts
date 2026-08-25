import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/daily-report-layout"
import type { DailyReportLayout } from "@/lib/types"

export function dailyReportLayoutKey(userId: string | undefined) {
  return ["dailyReportLayout", userId] as const
}

// `userId` is only passed for admins — staff never fetch this (the query is
// disabled), so they always fall back to the hardcoded default layout.
export function useMyDailyReportLayout(userId: string | undefined) {
  return useQuery({
    queryKey: dailyReportLayoutKey(userId),
    queryFn: () => api.getMyDailyReportLayout(userId as string),
    enabled: !!userId,
  })
}

export function useSaveMyDailyReportLayout(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<DailyReportLayout>) => api.saveMyDailyReportLayout(userId as string, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: dailyReportLayoutKey(userId) }),
  })
}
