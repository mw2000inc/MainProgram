import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/repair-plans"
import type { RepairPlan } from "@/lib/types"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"

export const repairPlansKey = ["repairPlans"] as const

export function useRepairPlans() {
  return useQuery({ queryKey: repairPlansKey, queryFn: api.listRepairPlans })
}

export function useCreateRepairPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<RepairPlan, "id" | "createdAt">) => api.createRepairPlan(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: repairPlansKey })
      toast.success("Repair plan added")
    },
    onError: () => toast.error("Failed to add repair plan"),
  })
}

export function useUpdateRepairPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<RepairPlan, "id" | "createdAt">> }) =>
      api.updateRepairPlan(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: repairPlansKey })
      toast.success("Repair plan updated")
    },
    onError: () => toast.error("Failed to update repair plan"),
  })
}

export function useDeleteRepairPlans() {
  const qc = useQueryClient()
  const { t } = useTranslation("common")
  return useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? api.deleteRepairPlan(ids[0]) : api.deleteRepairPlans(ids)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: repairPlansKey })
      toast.success(t("removed"))
    },
    onError: () => toast.error(t("failedToRemove")),
  })
}
