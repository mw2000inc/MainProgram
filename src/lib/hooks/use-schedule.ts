import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/schedule"
import type { ScheduleJob } from "@/lib/types"
import { toast } from "sonner"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"

export const scheduleJobsKey = ["scheduleJobs"] as const

export function useScheduleJobs() {
  return useQuery({ queryKey: scheduleJobsKey, queryFn: api.listScheduleJobs })
}

export function useCreateScheduleJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<ScheduleJob, "id" | "createdAt">) => api.createScheduleJob(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      toast.success("Job scheduled")
    },
    onError: () => toast.error("Failed to schedule job"),
  })
}

export function useUpdateScheduleJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<ScheduleJob, "id" | "createdAt">> }) =>
      api.updateScheduleJob(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      toast.success("Job updated")
    },
    onError: () => toast.error("Failed to update job"),
  })
}

export function useDeleteScheduleJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteScheduleJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      toast.success("Job removed")
    },
    onError: () => toast.error("Failed to remove job"),
  })
}

// Same preview-then-apply shape as use-filter-change-plans.ts's own
// usePreviewTechnicianSuggestions/useApplyTechnicianAssignments.
export function usePreviewTechnicianSuggestionsForJobs() {
  return useMutation({
    mutationFn: (jobIds: string[]) => api.previewTechnicianSuggestionsForJobs(jobIds),
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useApplyTechnicianAssignmentsToJobs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assignments: { jobId: string; technician: string; technician2?: string }[]) =>
      api.applyTechnicianAssignmentsToJobs(assignments),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      toast.success(`Assigned ${result.applied} job(s)`)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

// Same three plan-query keys useApproveDraftAssignments already invalidates
// — clearing is the mirror image of approving, so anything reading
// filter_change_plans/collections/repair_plans needs to pick up the
// now-blank technician the same way.
export function useClearScheduleForDate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (targetDate: string) => api.clearScheduleForDate(targetDate),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      qc.invalidateQueries({ queryKey: collectionsKey })
      qc.invalidateQueries({ queryKey: repairPlansKey })
      toast.success(`Cleared ${result.jobsCleared} job(s)`)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
