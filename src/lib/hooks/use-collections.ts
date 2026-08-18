import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/collections"
import type { CollectionPlan } from "@/lib/types"
import { toast } from "sonner"

export const collectionsKey = ["collections"] as const

export function useCollections() {
  return useQuery({ queryKey: collectionsKey, queryFn: api.listCollections })
}

export function useCreateCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<CollectionPlan, "id" | "createdAt">) => api.createCollection(input),
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
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<CollectionPlan, "id" | "createdAt">> }) =>
      api.updateCollection(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: collectionsKey })
      toast.success("Collection plan updated")
    },
    onError: () => toast.error("Failed to update collection plan"),
  })
}

export function useDeleteCollections() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? api.deleteCollection(ids[0]) : api.deleteCollections(ids)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: collectionsKey })
      toast.success("Removed")
    },
    onError: () => toast.error("Failed to remove"),
  })
}
