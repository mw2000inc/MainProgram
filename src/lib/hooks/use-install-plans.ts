import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/install-plans"
import type { InstallPlan } from "@/lib/types"
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
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<InstallPlan, "id" | "createdAt">> }) =>
      api.updateInstallPlan(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: installPlansKey })
      toast.success("Install plan updated")
    },
    onError: () => toast.error("Failed to update install plan"),
  })
}

export function useDeleteInstallPlans() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? api.deleteInstallPlan(ids[0]) : api.deleteInstallPlans(ids)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: installPlansKey })
      toast.success("Removed")
    },
    onError: () => toast.error("Failed to remove"),
  })
}
