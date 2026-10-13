"use client"

import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { linkVisitToScheduleJob } from "@/lib/api/schedule"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { useCustomers } from "@/lib/hooks/use-customers"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { useUsers } from "@/lib/hooks/use-misc"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { scheduleJobsKey, useCreateScheduleJob, useScheduleJobs } from "@/lib/hooks/use-schedule"
import { createDispatchAssigner } from "@/lib/scheduling/dispatch-assignment"
import { usePreviousTechnicians } from "@/lib/scheduling/use-previous-technicians"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { useDuplicateJobGuard } from "@/lib/scheduling/use-duplicate-job-guard"
import { assignmentAccounts, crewOfTechnician, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"
import { formatDate } from "@/lib/utils"

type DraftOptions = {
  table: "install_plans" | "repair_plans" | "collections"
  jobType: "installation" | "repair" | "collection"
  recordId: string
  // The record's job, if it already has one — then nothing is created.
  existingJobId?: string
  // The visit's date (Pre Installed Date / Pre D, else its base date); none → no draft.
  date?: string
  orderNo?: string
  address?: string
  technician?: string
  technician2?: string
  // Job notes; null → built from accountName, the order's Product (Sale
  // List) and amount: "Account — Product — ₱1,500".
  notes?: string | null
  accountName?: string
  amount?: number
}

const VISIT_KEYS = { install_plans: installPlansKey, repair_plans: repairPlansKey, collections: collectionsKey } as const

// Approval first: an Installation, Repair or Collection saved with a date gets its draft
// schedule job straight away ('pending_approval', on that date), with the
// order, member, address (the record's, else the member's), technicians (and their logins, so it reaches their
// own Daily Report once approved — technicians never see drafts) and the
// crew's vehicle when the technicians are a fixed crew (either member brings
// the whole crew, dispatch-assignment.ts). The draft is linked to its record
// at once, so it waits in Schedule › Pending Schedule Approval under its date,
// and approving it never creates a second record (the database only adds a
// record for an APPROVED job with none linked). Approval then writes the date
// to the record's Pre D and confirms it (20261026/20261028) — Acc D stays
// empty until the work is done — and later date changes on the record move
// the job by themselves (20261025).
export function useVisitDraftJob() {
  const createJob = useCreateScheduleJob()
  const { data: users = [] } = useUsers()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const qc = useQueryClient()
  const { t } = useTranslation("schedule")
  const duplicateWarning = useDuplicateJobGuard()
  const { data: jobs = [] } = useScheduleJobs()
  const previous = usePreviousTechnicians()

  return async function ensureVisitDraftJob(o: DraftOptions) {
    if (!o.date || o.existingJobId) return
    const orderNo = (o.orderNo ?? "").trim()
    const customer = orderNo ? findCustomerByOrderNumber(customers, saleListEntries, orderNo) : undefined
    const accounts = assignmentAccounts(users)
    // The record's own technician(s); none picked → the same automatic
    // assignment as the nightly drafts (createDispatchAssigner: same place
    // that day → the member's technician → whoever last serviced the order →
    // nearby → least busy; never on a Saturday). A crew member brings the
    // whole crew and its vehicle either way.
    const picked = normalizeTechnicianPair(o.technician ?? "", o.technician2 ?? "")
    const assigned = picked.primary
      ? undefined
      : createDispatchAssigner({ jobs, customers, accounts, previous })(
          {
            key: `${o.table}:${o.recordId}`,
            table: o.table,
            recordId: o.recordId,
            jobType: o.jobType,
            date: o.date,
            orderNo,
            customerId: customer?.id,
            name: o.accountName ?? orderNo,
            address: o.address?.trim() || customer?.address?.trim(),
            technician: "",
            technician2: "",
          },
          o.date
        )
    const base = assigned?.pair ?? picked
    const crew = crewOfTechnician(base.primary) ?? crewOfTechnician(base.secondary)
    const pair = crew ? { primary: crew.primary, secondary: crew.secondary } : base
    const ids = technicianAccountIds(pair.primary, pair.secondary, accounts)
    const product = orderNo ? saleListEntries.find((e) => e.orderNumber.trim() === orderNo)?.productNo?.trim() : undefined
    const notes =
      o.notes !== null
        ? o.notes
        : [o.accountName?.trim(), product, o.amount ? `₱${o.amount.toLocaleString()}` : ""].filter(Boolean).join(" — ")
    const address = o.address?.trim() || customer?.address?.trim()
    try {
      // One open job per order and type: the record is saved, but no second
      // draft is made — the warning says where the existing one is.
      const duplicate = await duplicateWarning(o.jobType, orderNo)
      if (duplicate) {
        toast.warning(duplicate)
        return
      }
      const job = await createJob.mutateAsync({
        jobType: o.jobType,
        status: "pending_approval",
        scheduledDate: o.date,
        orderNo: orderNo || undefined,
        customerId: customer?.id,
        technician: pair.primary,
        technician2: pair.secondary,
        technicianUserId: ids.technicianUserId || "",
        technician2UserId: ids.technician2UserId || "",
        vehicle: crew?.vehicle ?? assigned?.vehicle ?? "",
        secondaryAddress: address || undefined,
        notes: notes || undefined,
      })
      await linkVisitToScheduleJob(o.table, o.recordId, job.id)
      // At once in Pending Schedule Approval and the record's own table.
      qc.invalidateQueries({ queryKey: VISIT_KEYS[o.table] })
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      toast.success(t("visitDraftCreated", { type: t(o.jobType), date: formatDate(o.date) }))
    } catch (error) {
      toast.error(t("visitDraftFailed", { message: error instanceof Error ? error.message : String(error) }))
    }
  }
}
