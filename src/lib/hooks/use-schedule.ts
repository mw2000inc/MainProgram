import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/schedule"
import type { ScheduleJob } from "@/lib/types"
import { toast } from "sonner"

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
