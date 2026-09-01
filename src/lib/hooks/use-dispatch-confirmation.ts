import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import * as api from "@/lib/api/dispatch-confirmation"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"

// Approving invalidates all four plan queries rather than just the one the
// approved item belongs to — cheap (four cache keys, not four network
// calls if the others aren't mounted) and means the Pending Dispatch
// Approval queue itself (which reads all four) always reflects the
// just-approved item disappearing from the Draft list immediately.
export function useApproveDispatchItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.approveDispatchItem,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      qc.invalidateQueries({ queryKey: installPlansKey })
      qc.invalidateQueries({ queryKey: collectionsKey })
      qc.invalidateQueries({ queryKey: repairPlansKey })
      if (result) {
        toast.success("Approved — confirmation link generated (no real SMS/Email provider is connected yet, see the logged stub).")
      } else {
        toast.error("That item is no longer awaiting approval.")
      }
    },
    onError: () => toast.error("Failed to approve this dispatch item"),
  })
}

export function useDispatchConfirmationDetails(token: string | undefined) {
  return useQuery({
    queryKey: ["dispatchConfirmationDetails", token],
    queryFn: () => api.getDispatchConfirmationDetails(token as string),
    enabled: !!token,
  })
}

export function useRespondToDispatchConfirmation() {
  return useMutation({
    mutationFn: ({ token, action }: { token: string; action: "confirm" | "reschedule" }) =>
      api.respondToDispatchConfirmation(token, action),
  })
}
