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

const DATE_FIELDS = new Set(["preD", "accD", "planDate"])

export function useUpdateFilterChangePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<FilterChangePlan, "id" | "createdAt">> }) =>
      api.updateFilterChangePlan(id, input),
    // Shown straight away (e.g. setting Acc D flips the Status badge to
    // Completed in the same click) and rolled back if the save fails; the
    // refetch below then confirms what the database actually holds.
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: filterChangePlansKey })
      const previous = qc.getQueryData<FilterChangePlan[]>(filterChangePlansKey)
      if (previous) {
        // A cleared date is sent as "" but held as undefined once read back.
        const cleared = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === "" && DATE_FIELDS.has(k) ? undefined : v]))
        qc.setQueryData<FilterChangePlan[]>(filterChangePlansKey, previous.map((p) => (p.id === id ? { ...p, ...cleared } : p)))
      }
      return { previous }
    },
    onSuccess: () => {
      toast.success("Filter change plan updated")
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(filterChangePlansKey, context.previous)
      toast.error("Failed to update filter change plan")
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
    },
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

// Read-only, same reasoning as useSuggestTechnician above — no cache to
// invalidate since nothing is written until useApplyTechnicianAssignments
// below actually runs.
export function usePreviewTechnicianSuggestions() {
  return useMutation({
    mutationFn: (planIds: string[]) => api.previewTechnicianSuggestions(planIds),
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useApplyTechnicianAssignments() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assignments: { planId: string; technician: string }[]) => api.applyTechnicianAssignments(assignments),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      toast.success(`Assigned ${result.applied} plan(s)`)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
