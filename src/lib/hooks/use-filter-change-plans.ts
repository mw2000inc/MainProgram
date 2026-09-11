import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/filter-change-plans"
import type { FilterChangePlan } from "@/lib/types"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"

export const filterChangePlansKey = ["filterChangePlans"] as const

export function useFilterChangePlans() {
  return useQuery({ queryKey: filterChangePlansKey, queryFn: api.listFilterChangePlans })
}

export function useCreateFilterChangePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<FilterChangePlan, "id" | "createdAt">) => api.createFilterChangePlan(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      toast.success("Filter change plan added")
    },
    onError: () => toast.error("Failed to add filter change plan"),
  })
}

export function useUpdateFilterChangePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<FilterChangePlan, "id" | "createdAt">> }) =>
      api.updateFilterChangePlan(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      toast.success("Filter change plan updated")
    },
    onError: () => toast.error("Failed to update filter change plan"),
  })
}

export function useDeleteFilterChangePlans() {
  const qc = useQueryClient()
  const { t } = useTranslation("common")
  return useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? api.deleteFilterChangePlan(ids[0]) : api.deleteFilterChangePlans(ids)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      toast.success(t("removed"))
    },
    onError: () => toast.error(t("failedToRemove")),
  })
}

// Read-only — the caller (filter-change-form-dialog) applies the result to
// the form field itself; no cache to invalidate since nothing was written.
export function useSuggestTechnician() {
  return useMutation({
    mutationFn: (planId: string) => api.suggestTechnician(planId),
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useBulkSuggestTechnicians() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (planIds: string[]) => api.suggestTechniciansBulk(planIds),
    onSuccess: (summary) => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      const coverageNote = summary.flaggedOutsideCoverage > 0 ? `, ${summary.flaggedOutsideCoverage} outside usual coverage` : ""
      toast.success(`Assigned ${summary.assigned} plan(s)${coverageNote}${summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
