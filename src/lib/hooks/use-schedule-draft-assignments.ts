import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/schedule-draft-assignments"
import type { DraftAssignment, DraftEntityType } from "@/lib/api/schedule-draft-assignments"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { toast } from "sonner"

export function draftAssignmentsKey(targetDate: string) {
  return ["draftAssignments", targetDate] as const
}

export function useDraftAssignments(targetDate: string) {
  return useQuery({ queryKey: draftAssignmentsKey(targetDate), queryFn: () => api.listDraftAssignments(targetDate) })
}

export function useGenerateDraftAssignments() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (targetDate: string) => api.generateDraftAssignments(targetDate),
    onSuccess: (drafts, targetDate) => {
      qc.setQueryData(draftAssignmentsKey(targetDate), drafts)
      toast.success(drafts.length > 0 ? `Generated ${drafts.length} draft assignment(s)` : "No unassigned work found for that date")
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

// Same three query keys the plan pages themselves invalidate on any other
// technician edit — approving a draft IS that same edit, just batched, so
// /filter-change, /collection-plan, and /repair-plan (and anything else
// reading these, e.g. the Daily Report) pick up the new technician
// immediately rather than needing a manual refresh.
export function useApproveDraftAssignments(targetDate: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (drafts: { id: string; entityType: DraftEntityType; entityId: string; technician: string; technician2?: string }[]) =>
      api.approveDraftAssignments(drafts),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: draftAssignmentsKey(targetDate) })
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      qc.invalidateQueries({ queryKey: collectionsKey })
      qc.invalidateQueries({ queryKey: repairPlansKey })
      toast.success(`Approved ${result.approved} assignment(s)`)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useRejectDraftAssignments(targetDate: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => api.rejectDraftAssignments(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: draftAssignmentsKey(targetDate) }),
    onError: (error: Error) => toast.error(error.message),
  })
}

export type { DraftAssignment, DraftEntityType }
