"use client"

import * as React from "react"
import { resolveCustomerForPlan } from "@/lib/customer-lookup"
import { useCollections } from "@/lib/hooks/use-collections"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import type { ScheduleJob } from "@/lib/types"

export type JobDetails = { accountName?: string; address?: string; contactNumber?: string }

type DetailRecord = JobDetails & { orderNo: string; jobType: ScheduleJob["jobType"]; scheduleJobId?: string }

const clean = (v: string | undefined) => v?.trim() || undefined

// A schedule job's Account Name, Address and Contact Number, the same way for
// every job type and every Schedule view (Daily Report agenda, Pending
// Schedule Approval, Approve All review, Table View, full-screen search).
// Each field is taken from the first of these that has it:
//   1. the record the job is linked to — Filter Change "Member Account",
//      Installation "Name", Collection / Repair "Account Name", plus their
//      own Address / Contact Number;
//   2. the member, by the job's customer or its Order No. (via the Sale List)
//      — Member List Account Name, else its Contact Person. Admins only: a
//      technician can't read the Member List or Sale List (RLS), so for them
//      1 and 3 carry it — those records are open to the Daily Report;
//   3. another record with the job's Order No. — its own type first — for a
//      hand-made job that isn't linked to one.
// The job's own Secondary Address — where to go for this visit — wins over
// every address above.
export function useJobDetails(): (job: ScheduleJob) => JobDetails {
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()

  const { byJobId, byOrder } = React.useMemo(() => {
    const records: DetailRecord[] = [
      ...filterChangePlans.map((p) => ({ accountName: clean(p.memberAccount), address: clean(p.address), contactNumber: clean(p.contactNumber), orderNo: p.orderNumber, jobType: "filter_change" as const, scheduleJobId: p.scheduleJobId })),
      ...installPlans.map((p) => ({ accountName: clean(p.name), address: clean(p.address), contactNumber: clean(p.contactNumber), orderNo: p.orderNo, jobType: "installation" as const, scheduleJobId: p.scheduleJobId })),
      ...collections.map((p) => ({ accountName: clean(p.accountName), orderNo: p.orderNo, jobType: "collection" as const, scheduleJobId: p.scheduleJobId })),
      ...repairPlans.map((p) => ({ accountName: clean(p.accountName), address: clean(p.address), contactNumber: clean(p.contactNumber), orderNo: p.orderNo, jobType: "repair" as const, scheduleJobId: p.scheduleJobId })),
    ]
    const byJobId = new Map<string, DetailRecord>()
    const byOrder = new Map<string, DetailRecord[]>()
    for (const r of records) {
      if (r.scheduleJobId) byJobId.set(r.scheduleJobId, r)
      const order = (r.orderNo ?? "").trim()
      if (order) byOrder.set(order, [...(byOrder.get(order) ?? []), r])
    }
    return { byJobId, byOrder }
  }, [filterChangePlans, installPlans, collections, repairPlans])

  return React.useCallback(
    (job: ScheduleJob) => {
      const linked = byJobId.get(job.id)
      const orderNo = (job.orderNo ?? "").trim()
      const customer = resolveCustomerForPlan(customers, saleListEntries, job.customerId, orderNo)
      const member: JobDetails | undefined = customer && {
        accountName: clean(customer.companyName) ?? clean(customer.fullName),
        address: clean(customer.address),
        contactNumber: clean(customer.contactNumber),
      }
      const sameOrder = [...(orderNo ? byOrder.get(orderNo) ?? [] : [])].sort((a, b) => Number(b.jobType === job.jobType) - Number(a.jobType === job.jobType))
      const sources = [linked, member, ...sameOrder]
      const pick = (key: keyof JobDetails) => sources.find((s) => s?.[key])?.[key]
      return { accountName: pick("accountName"), address: clean(job.secondaryAddress) ?? pick("address"), contactNumber: pick("contactNumber") }
    },
    [byJobId, byOrder, customers, saleListEntries]
  )
}

// Just the Account Name (see useJobDetails); undefined when nothing has one.
export function useJobAccountName(): (job: ScheduleJob) => string | undefined {
  const details = useJobDetails()
  return React.useCallback((job: ScheduleJob) => details(job).accountName, [details])
}
