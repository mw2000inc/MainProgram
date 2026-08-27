import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/customers"
import type { Customer } from "@/lib/types"
import { toast } from "sonner"

export const customersKey = ["customers"] as const

export function useCustomers() {
  return useQuery({ queryKey: customersKey, queryFn: api.listCustomers })
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: [...customersKey, id],
    queryFn: () => api.getCustomer(id as string),
    enabled: !!id,
  })
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<Customer, "id" | "createdAt" | "orderNumber" | "contractNumber"> & { contractNumber?: string }) =>
      api.createCustomer(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customersKey })
      qc.invalidateQueries({ queryKey: ["contracts"] })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Customer added successfully")
    },
    onError: () => toast.error("Failed to add customer"),
  })
}

export function useUpdateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<Customer, "id" | "createdAt">> }) =>
      api.updateCustomer(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customersKey })
      qc.invalidateQueries({ queryKey: ["contracts"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Customer updated successfully")
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update customer"),
  })
}

export function useDeleteCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCustomer(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customersKey })
      qc.invalidateQueries({ queryKey: ["contracts"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Customer deleted")
    },
    onError: () => toast.error("Failed to delete customer"),
  })
}
