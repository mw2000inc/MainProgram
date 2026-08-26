import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/cp-systems"
import type { CpSystem } from "@/lib/types"
import { toast } from "sonner"

export const cpSystemsKey = ["cpSystems"] as const

export function useCpSystems() {
  return useQuery({ queryKey: cpSystemsKey, queryFn: api.listCpSystems })
}

export function useCreateCpSystem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<CpSystem, "id" | "createdAt">) => api.createCpSystem(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cpSystemsKey })
      toast.success("CP System added")
    },
    onError: (error: Error) => toast.error(error.message || "Failed to add CP System"),
  })
}

export function useUpdateCpSystem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<CpSystem, "id" | "createdAt">> }) =>
      api.updateCpSystem(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cpSystemsKey })
      toast.success("CP System updated")
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update CP System"),
  })
}

export function useDeleteCpSystem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCpSystem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cpSystemsKey })
      toast.success("CP System removed")
    },
    onError: () => toast.error("Failed to remove CP System"),
  })
}
