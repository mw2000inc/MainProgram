import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/sale-list"
import type { SaleListEntry } from "@/lib/types"
import { toast } from "sonner"

export const saleListKey = ["saleListEntries"] as const

export function useSaleListEntries() {
  return useQuery({ queryKey: saleListKey, queryFn: api.listSaleListEntries })
}

export function useCreateSaleListEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<SaleListEntry, "id" | "createdAt">) => api.createSaleListEntry(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: saleListKey })
      toast.success("Sale list entry added")
    },
    onError: () => toast.error("Failed to add sale list entry"),
  })
}

export function useUpdateSaleListEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<SaleListEntry, "id" | "createdAt">> }) =>
      api.updateSaleListEntry(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: saleListKey })
      toast.success("Sale list entry updated")
    },
    onError: () => toast.error("Failed to update sale list entry"),
  })
}

export function useDeleteSaleListEntries() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? api.deleteSaleListEntry(ids[0]) : api.deleteSaleListEntries(ids)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: saleListKey })
      toast.success("Removed")
    },
    onError: () => toast.error("Failed to remove"),
  })
}
