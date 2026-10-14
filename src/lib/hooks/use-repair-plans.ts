import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase/client"
import { syncRecordTechniciansToJob } from "@/lib/scheduling/technician-sync"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import { stockMovementsKey } from "@/lib/hooks/use-inventory"
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
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      toast.success("Repair plan added")
    },
    onError: () => toast.error("Failed to add repair plan"),
  })
}

export function useUpdateRepairPlan() {
  const qc = useQueryClient()
  return useMutation({
    // A changed TH goes to the record's open schedule job too (with the
    // crew rule and logins — syncRecordTechniciansToJob); the database then
    // writes the job's pair back to the record.
    mutationFn: async ({ id, input }: { id: string; input: Partial<Omit<RepairPlan, "id" | "createdAt">> }) => {
      const saved = await api.updateRepairPlan(id, input)
      if ("th" in input || "th2" in input) {
        try {
          if (await syncRecordTechniciansToJob(supabase, saved.scheduleJobId, saved.th, saved.th2)) {
            qc.invalidateQueries({ queryKey: scheduleJobsKey })
          }
        } catch {
          toast.error("Saved, but its schedule job's technician couldn't be updated")
        }
      }
      return saved
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: repairPlansKey })
      qc.invalidateQueries({ queryKey: stockMovementsKey })
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
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      toast.success(t("removed"))
    },
    onError: () => toast.error(t("failedToRemove")),
  })
}
