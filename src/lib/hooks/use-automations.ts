import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import * as api from "@/lib/api/automations"

export const automationsKey = ["automations"] as const

// The registry's own metadata + each automation's currently-resolved
// enabled state — see /api/automations/trigger's GET handler. Re-fetched
// after any Settings save (useUpdateSettings invalidates this key too,
// since a save there is how the enabled/disabled override actually
// changes) and after a manual run, which can't change enabled state but is
// cheap enough to just refetch alongside anyway.
export function useAutomations() {
  return useQuery({ queryKey: automationsKey, queryFn: api.listAutomations })
}

// Manually runs one registered automation right now, through the exact
// same engine (and audit logging) its own cron route uses — see
// runAutomation() in src/lib/automations/engine.ts.
export function useTriggerAutomation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (automationId: string) => api.triggerAutomation(automationId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: automationsKey })
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
