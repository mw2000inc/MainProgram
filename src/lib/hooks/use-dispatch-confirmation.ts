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
// Reports each channel's real outcome rather than a single generic
// success toast — 'sent' means the provider actually accepted it,
// 'skipped_no_provider' means that channel's API key isn't configured yet
// (see the route's own comment), and 'failed' means the provider rejected
// it (check server logs / dispatch_notifications for detail).
function summarizeChannel(name: string, result?: api.DispatchChannelResult): string | null {
  if (!result) return null
  if (result.status === "sent") return `${name} sent`
  if (result.status === "skipped_no_provider") return `${name} skipped (no provider configured)`
  return `${name} failed`
}

export const dispatchNotificationsKey = ["dispatchNotifications"] as const

export function useDispatchNotifications() {
  return useQuery({ queryKey: dispatchNotificationsKey, queryFn: api.listDispatchNotifications })
}

export function useApproveDispatchItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.approveDispatchItem,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      qc.invalidateQueries({ queryKey: installPlansKey })
      qc.invalidateQueries({ queryKey: collectionsKey })
      qc.invalidateQueries({ queryKey: repairPlansKey })
      qc.invalidateQueries({ queryKey: dispatchNotificationsKey })
      if (!result) {
        toast.error("That item is no longer awaiting approval.")
        return
      }
      const summaries = [summarizeChannel("SMS", result.sms), summarizeChannel("Email", result.email)].filter(Boolean)
      const anyFailed = result.sms?.status === "failed" || result.email?.status === "failed"
      const message = summaries.length > 0 ? summaries.join(" · ") : "Approved"
      if (anyFailed) toast.error(message)
      else toast.success(message)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to approve this dispatch item"),
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
    mutationFn: ({
      token,
      action,
      requestedDate,
      requestedTime,
    }: {
      token: string
      action: "confirm" | "reschedule"
      requestedDate?: string
      requestedTime?: string
    }) => api.respondToDispatchConfirmation(token, action, requestedDate, requestedTime),
  })
}

// Same cache-invalidation shape as useApproveDispatchItem — the Reschedule
// Requests section (which reads all four plan queries) needs the just-
// accepted item to disappear from that list immediately.
export function useAcceptRequestedReschedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.acceptRequestedReschedule,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      qc.invalidateQueries({ queryKey: installPlansKey })
      qc.invalidateQueries({ queryKey: collectionsKey })
      qc.invalidateQueries({ queryKey: repairPlansKey })
      qc.invalidateQueries({ queryKey: dispatchNotificationsKey })
      if (!result) {
        toast.error("That item is no longer a pending reschedule request.")
        return
      }
      const summaries = [summarizeChannel("SMS", result.sms), summarizeChannel("Email", result.email)].filter(Boolean)
      const anyFailed = result.sms?.status === "failed" || result.email?.status === "failed"
      const message = summaries.length > 0 ? summaries.join(" · ") : "Confirmed"
      if (anyFailed) toast.error(message)
      else toast.success(message)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to accept this requested reschedule"),
  })
}
