import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/schedule"
import type { ScheduleJob } from "@/lib/types"
import { toast } from "sonner"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { installPlansKey } from "@/lib/hooks/use-install-plans"

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
    mutationFn: ({
      assignments,
      newJobs = [],
    }: {
      assignments: { jobId: string; technician: string; technician2?: string; changes?: api.ScheduleJobEdits }[]
      newJobs?: api.ScheduleNewJob[]
    }) => api.applyTechnicianAssignmentsToJobs(assignments, newJobs),
    // The apply also copies each technician onto the job's Filter Change/
    // Collection/Repair row (syncTechnicianToSourcePlan), which the Daily
    // Report's own panels read — refetch those too so the assignment shows
    // there straight away, not on the next page load.
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      qc.invalidateQueries({ queryKey: collectionsKey })
      qc.invalidateQueries({ queryKey: repairPlansKey })
      const parts = [`Assigned ${result.applied} job(s)`]
      if (result.jobsCreated) parts.push(`added ${result.jobsCreated} task(s)/errand(s)`)
      if (result.applied || result.jobsCreated) toast.success(`${parts.join(" and ")} — published to the Daily Report`)
      if (result.failed?.length) toast.error(`${result.failed.length} could not be saved: ${result.failed.join("; ")}`)
      if (result.unlinked?.length) {
        toast.warning(
          `No technician login matches ${result.unlinked.join(", ")} — admins see these jobs in the Daily Report, but that technician won't until a login is linked (edit the job's Technician Account).`
        )
      }
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

// Batch completion from the Schedule full-screen view. Refreshes everything
// it can change: the jobs, their linked Filter Change / install / repair
// records, and the inventory movements their completion queued.
export function useCompleteScheduleJobs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jobIds, today }: { jobIds: string[]; today: string }) => api.completeScheduleJobs(jobIds, today),
    onSuccess: (result) => {
      const extra = [
        result.filterChangeVisits ? `${result.filterChangeVisits} Filter Change visit(s)` : "",
        result.installs ? `${result.installs} install(s)` : "",
        result.repairs ? `${result.repairs} repair(s)` : "",
      ].filter(Boolean)
      toast.success(
        `Completed ${result.completed} job(s)` +
          (extra.length ? ` and ${extra.join(", ")}` : "") +
          (result.queuedFromJobs ? ` — ${result.queuedFromJobs} item(s) queued for inventory approval` : "")
      )
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      qc.invalidateQueries({ queryKey: filterChangePlansKey })
      qc.invalidateQueries({ queryKey: installPlansKey })
      qc.invalidateQueries({ queryKey: repairPlansKey })
      qc.invalidateQueries({ queryKey: ["stockMovements"] })
    },
  })
}
