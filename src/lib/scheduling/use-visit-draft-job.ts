"use client"

import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { linkVisitToScheduleJob } from "@/lib/api/schedule"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { useCustomers } from "@/lib/hooks/use-customers"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { useUsers } from "@/lib/hooks/use-misc"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { scheduleJobsKey, useCreateScheduleJob } from "@/lib/hooks/use-schedule"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { assignmentAccounts, crewOfTechnician, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"
import { formatDate } from "@/lib/utils"

type DraftOptions = {
  table: "install_plans" | "repair_plans"
  jobType: "installation" | "repair"
  recordId: string
  // The record's job, if it already has one — then nothing is created.
  existingJobId?: string
  // The visit's date (Pre Installed Date / Pre D, else its base date); none → no draft.
  date?: string
  orderNo?: string
  address?: string
  technician?: string
  technician2?: string
  notes?: string
}

// Approval first: an Installation or Repair saved with a date gets its draft
// schedule job straight away ('pending_approval', on that date), with the
// order, member, address, technicians (and their logins, so it reaches their
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

  return async function ensureVisitDraftJob(o: DraftOptions) {
    if (!o.date || o.existingJobId) return
    const picked = normalizeTechnicianPair(o.technician ?? "", o.technician2 ?? "")
    const crew = crewOfTechnician(picked.primary) ?? crewOfTechnician(picked.secondary)
    const pair = crew ? { primary: crew.primary, secondary: crew.secondary } : picked
    const ids = technicianAccountIds(pair.primary, pair.secondary, assignmentAccounts(users))
    const orderNo = (o.orderNo ?? "").trim()
    const customer = orderNo ? findCustomerByOrderNumber(customers, saleListEntries, orderNo) : undefined
    try {
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
        vehicle: crew?.vehicle ?? "",
        secondaryAddress: o.address || undefined,
        notes: o.notes || undefined,
      })
      await linkVisitToScheduleJob(o.table, o.recordId, job.id)
      qc.invalidateQueries({ queryKey: o.table === "install_plans" ? installPlansKey : repairPlansKey })
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      toast.success(t("visitDraftCreated", { type: t(o.jobType), date: formatDate(o.date) }))
    } catch (error) {
      toast.error(t("visitDraftFailed", { message: error instanceof Error ? error.message : String(error) }))
    }
  }
}
