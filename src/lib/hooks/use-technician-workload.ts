import * as React from "react"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useCustomers } from "@/lib/hooks/use-customers"
import { buildWorkloadIndex, buildWorkloadRecords } from "@/lib/technician-workload"

// Every technician's week/month workload (see technician-workload.ts): the
// records behind it and the per-technician counts, from the same shared
// queries the rest of the app already caches — used by the Schedule toolbar,
// its history dialog and the Auto-suggest modal, so all three agree.
export function useTechnicianWorkload() {
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: scheduleJobs = [] } = useScheduleJobs()
  const { data: customers = [] } = useCustomers()
  const records = React.useMemo(
    () => buildWorkloadRecords({ filterChangePlans, collections, repairPlans, installPlans, scheduleJobs, customers }),
    [filterChangePlans, collections, repairPlans, installPlans, scheduleJobs, customers]
  )
  const index = React.useMemo(() => buildWorkloadIndex(records), [records])
  return { records, index }
}

export function useTechnicianWorkloadIndex() {
  return useTechnicianWorkload().index
}
