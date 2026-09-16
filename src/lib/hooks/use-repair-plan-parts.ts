import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/repair-plan-parts"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"

export function repairPlanPartsKey(repairPlanId: string) {
  return ["repairPlanParts", repairPlanId] as const
}

type PartInput = {
  productId?: string
  customPartNo?: string
  customPartName?: string
  inOut: "IN" | "OUT"
  quantity: number
  partDate: string
}

export function useRepairPlanParts(repairPlanId: string | undefined) {
  return useQuery({
    queryKey: repairPlanPartsKey(repairPlanId ?? ""),
    queryFn: () => api.listRepairPlanParts(repairPlanId as string),
    enabled: !!repairPlanId,
  })
}

export function useCreateRepairPlanPart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ repairPlanId, input }: { repairPlanId: string; input: PartInput }) =>
      api.createRepairPlanPart(repairPlanId, input),
    onSuccess: (_data, { repairPlanId }) => {
      qc.invalidateQueries({ queryKey: repairPlanPartsKey(repairPlanId) })
      toast.success("Part added")
    },
    onError: () => toast.error("Failed to add part"),
  })
}

export function useUpdateRepairPlanPart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; repairPlanId: string; input: PartInput }) =>
      api.updateRepairPlanPart(id, input),
    onSuccess: (_data, { repairPlanId }) => {
      qc.invalidateQueries({ queryKey: repairPlanPartsKey(repairPlanId) })
      toast.success("Part updated")
    },
    onError: () => toast.error("Failed to update part"),
  })
}

export function useDeleteRepairPlanPart() {
  const qc = useQueryClient()
  const { t } = useTranslation("common")
  return useMutation({
    mutationFn: ({ id }: { id: string; repairPlanId: string }) => api.deleteRepairPlanPart(id),
    onSuccess: (_data, { repairPlanId }) => {
      qc.invalidateQueries({ queryKey: repairPlanPartsKey(repairPlanId) })
      toast.success(t("removed"))
    },
    onError: () => toast.error(t("failedToRemove")),
  })
}
