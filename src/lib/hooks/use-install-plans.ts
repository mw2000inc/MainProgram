import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase/client"
import { syncRecordTechniciansToJob } from "@/lib/scheduling/technician-sync"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import * as api from "@/lib/api/install-plans"
import type { InstallPlan } from "@/lib/types"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"

export const installPlansKey = ["installPlans"] as const

export function useInstallPlans() {
  return useQuery({ queryKey: installPlansKey, queryFn: api.listInstallPlans })
}

export function useCreateInstallPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<InstallPlan, "id" | "createdAt">) => api.createInstallPlan(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: installPlansKey })
      toast.success("Install plan added")
    },
    onError: () => toast.error("Failed to add install plan"),
  })
}

export function useUpdateInstallPlan() {
  const qc = useQueryClient()
  return useMutation({
    // A changed Serviceman goes to the record's open schedule job too (with the
    // crew rule and logins — syncRecordTechniciansToJob); the database then
    // writes the job's pair back to the record.
    mutationFn: async ({ id, input }: { id: string; input: Partial<Omit<InstallPlan, "id" | "createdAt">> }) => {
      const saved = await api.updateInstallPlan(id, input)
      if ("serviceman" in input || "serviceman2" in input) {
        try {
          if (await syncRecordTechniciansToJob(supabase, saved.scheduleJobId, saved.serviceman, saved.serviceman2)) {
            qc.invalidateQueries({ queryKey: scheduleJobsKey })
          }
        } catch {
          toast.error("Saved, but its schedule job's technician couldn't be updated")
        }
      }
      return saved
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: installPlansKey })
      toast.success("Install plan updated")
    },
    onError: () => toast.error("Failed to update install plan"),
  })
}

export function useDeleteInstallPlans() {
  const qc = useQueryClient()
  const { t } = useTranslation("common")
  return useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? api.deleteInstallPlan(ids[0]) : api.deleteInstallPlans(ids)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: installPlansKey })
      toast.success(t("removed"))
    },
    onError: () => toast.error(t("failedToRemove")),
  })
}
