import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase/client"
import { filterChangeTechniciansFor, syncRecordTechniciansToJob } from "@/lib/scheduling/technician-sync"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import * as api from "@/lib/api/collections"
import type { CollectionPlan } from "@/lib/types"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"

export const collectionsKey = ["collections"] as const

export function useCollections() {
  return useQuery({ queryKey: collectionsKey, queryFn: api.listCollections })
}

export function useCreateCollection() {
  const qc = useQueryClient()
  return useMutation({
    // No Serviceman picked → the technicians of the open Filter Change visit on
    // the same order and date (same trip), when there is one.
    mutationFn: async (input: Omit<CollectionPlan, "id" | "createdAt">) => {
      if (!input.serviceman?.trim()) {
        const pair = await filterChangeTechniciansFor(supabase, input.orderNo, input.collectionDate).catch(() => null)
        if (pair) input = { ...input, serviceman: pair.primary, serviceman2: pair.secondary }
      }
      return api.createCollection(input)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: collectionsKey })
      toast.success("Collection plan added")
    },
    onError: () => toast.error("Failed to add collection plan"),
  })
}

export function useUpdateCollection() {
  const qc = useQueryClient()
  return useMutation({
    // A changed Serviceman goes to the record's open schedule job too (with the
    // crew rule and logins — syncRecordTechniciansToJob); the database then
    // writes the job's pair back to the record.
    mutationFn: async ({ id, input }: { id: string; input: Partial<Omit<CollectionPlan, "id" | "createdAt">> }) => {
      const saved = await api.updateCollection(id, input)
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
      qc.invalidateQueries({ queryKey: collectionsKey })
      toast.success("Collection plan updated")
    },
    onError: () => toast.error("Failed to update collection plan"),
  })
}

export function useDeleteCollections() {
  const qc = useQueryClient()
  const { t } = useTranslation("common")
  return useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? api.deleteCollection(ids[0]) : api.deleteCollections(ids)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: collectionsKey })
      toast.success(t("removed"))
    },
    onError: () => toast.error(t("failedToRemove")),
  })
}
