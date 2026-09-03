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
