"use client"

import * as React from "react"
import { useCollections } from "@/lib/hooks/use-collections"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { previousTechniciansByOrder } from "@/lib/scheduling/dispatch-assignment"

// Who last serviced each order, in the browser — the same rule the nightly
// draft run uses (previousTechniciansByOrder): completed jobs, and done
// Filter Change / Collection / Installation / Repair records.
export function usePreviousTechnicians() {
  const { data: jobs = [] } = useScheduleJobs()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: collections = [] } = useCollections()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: repairPlans = [] } = useRepairPlans()
  return React.useMemo(
    () =>
      previousTechniciansByOrder([
        ...jobs.filter((j) => j.status === "completed").map((j) => ({ orderNo: j.orderNo, technician: j.technician, technician2: j.technician2, date: j.scheduledDate })),
        ...filterChangePlans.filter((p) => p.accD).map((p) => ({ orderNo: p.orderNumber, technician: p.serviceman, technician2: p.serviceman2, date: p.accD })),
        ...collections.filter((p) => p.accD).map((p) => ({ orderNo: p.orderNo, technician: p.serviceman, technician2: p.serviceman2, date: p.accD })),
        ...installPlans.filter((p) => p.installedDate).map((p) => ({ orderNo: p.orderNo, technician: p.serviceman, technician2: p.serviceman2, date: p.installedDate })),
        ...repairPlans.filter((p) => p.accD).map((p) => ({ orderNo: p.orderNo, technician: p.th, technician2: p.th2, date: p.accD })),
      ]),
    [jobs, filterChangePlans, collections, installPlans, repairPlans]
  )
}
