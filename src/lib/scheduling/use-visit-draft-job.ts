"use client"

import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { linkVisitToScheduleJob, updateScheduleJob } from "@/lib/api/schedule"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { businessToday } from "@/lib/dispatch-lead-time"
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
import { assignmentAccounts, crewOfTechnician, isAssignedTechnician, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"
import { formatDate } from "@/lib/utils"

type DraftOptions = {
  table: "install_plans" | "repair_plans" | "collections" | "filter_change_plans"
  jobType: "installation" | "repair" | "collection" | "filter_change"
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
  // A Filter Change's filters (its Filter field) — what the technician brings
  // and what's deducted on completion.
  filterCodes?: string
  // The vehicle picked on the form: the job's vehicle (else the crew's /
  // automatic one), and filled into the technician's other jobs that day that
  // have none yet — so it shows on their Daily Report and Release Slip. On a
  // record that already has a job, a different vehicle updates that job.
  vehicle?: string
  // Saved by an admin from the Daily Report: the job is approved at once (no
  // Pending Schedule Approval step) — a new one right after it's created, and
  // a record's existing draft when the record is edited there. Only with a
  // technician; without one it stays a draft.
  approve?: boolean
}

const VISIT_KEYS = { install_plans: installPlansKey, repair_plans: repairPlansKey, collections: collectionsKey, filter_change_plans: filterChangePlansKey } as const

// Approval first: an Installation, Repair, Collection or Filter Change saved with a date gets its draft
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

  // The same switch the Schedule's Approve makes ('pending_approval' →
  // 'pending'), so the database confirms the record and writes its Pre D just
  // as it does on any approval.
  const approveJob = async (jobId: string, table: DraftOptions["table"]) => {
    await updateScheduleJob(jobId, { status: "pending" })
    qc.invalidateQueries({ queryKey: VISIT_KEYS[table] })
    qc.invalidateQueries({ queryKey: scheduleJobsKey })
  }

  // The picked vehicle onto the technician's other open jobs that day that
  // have no vehicle yet (one vehicle per technician per day).
  const fillTechnicianDay = async (jobId: string, date: string, ids: (string | undefined)[], vehicle: string) => {
    const mine = ids.filter(Boolean) as string[]
    if (!vehicle || !mine.length) return
    const others = jobs.filter(
      (j) =>
        j.id !== jobId &&
        j.scheduledDate === date &&
        (j.status === "pending" || j.status === "pending_approval") &&
        !(j.vehicle ?? "").trim() &&
        [j.technicianUserId, j.technician2UserId].some((id) => !!id && mine.includes(id))
    )
    for (const j of others) await updateScheduleJob(j.id, { vehicle }).catch(() => undefined)
  }

  return async function ensureVisitDraftJob(o: DraftOptions) {
    if (o.existingJobId) {
      // Edited from the Daily Report: a draft still waiting is approved now.
      const existing = jobs.find((j) => j.id === o.existingJobId)
      const vehicle = (o.vehicle ?? "").trim()
      if (existing && vehicle && vehicle !== (existing.vehicle ?? "").trim()) {
        await updateScheduleJob(existing.id, { vehicle }).catch(() => undefined)
        await fillTechnicianDay(existing.id, existing.scheduledDate, [existing.technicianUserId, existing.technician2UserId], vehicle)
        qc.invalidateQueries({ queryKey: scheduleJobsKey })
      }
      if (o.approve && existing?.status === "pending_approval" && isAssignedTechnician(existing.technician)) {
        try {
          await approveJob(existing.id, o.table)
          toast.success(t("visitJobApproved", { type: t(o.jobType), date: formatDate(existing.scheduledDate) }))
        } catch (error) {
          toast.error(t("visitDraftFailed", { message: error instanceof Error ? error.message : String(error) }))
        }
      }
      return
    }
    if (!o.date) return
    // Today (or any later date) is drafted on that date — a same-day entry
    // waits under today in Pending Schedule Approval and reaches today's
    // Daily Report once approved. An already-past date is drafted for today.
    const today = businessToday()
    const date = o.date < today ? today : o.date
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
            date,
            orderNo,
            customerId: customer?.id,
            name: o.accountName ?? orderNo,
            address: o.address?.trim() || customer?.address?.trim(),
            technician: "",
            technician2: "",
          },
          date
        )
    // Technicians picked on the form are kept exactly as picked; only an
    // automatic pick brings the whole crew (createDispatchAssigner already
    // applies that rule itself).
    const pair = assigned?.pair ?? picked
    const crew = assigned ? crewOfTechnician(pair.primary) ?? crewOfTechnician(pair.secondary) : undefined
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
        scheduledDate: date,
        orderNo: orderNo || undefined,
        customerId: customer?.id,
        technician: pair.primary,
        technician2: pair.secondary,
        technicianUserId: ids.technicianUserId || "",
        technician2UserId: ids.technician2UserId || "",
        vehicle: (o.vehicle ?? "").trim() || crew?.vehicle || assigned?.vehicle || "",
        secondaryAddress: address || undefined,
        notes: notes || undefined,
        filterCodes: o.filterCodes?.trim() || undefined,
      })
      await linkVisitToScheduleJob(o.table, o.recordId, job.id)
      if ((o.vehicle ?? "").trim()) await fillTechnicianDay(job.id, date, [ids.technicianUserId, ids.technician2UserId], (o.vehicle ?? "").trim())
      if (o.approve && isAssignedTechnician(pair.primary)) {
        // Saved from the Daily Report: approved straight away.
        await approveJob(job.id, o.table)
        toast.success(t("visitJobApproved", { type: t(o.jobType), date: formatDate(date) }))
        return
      }
      // At once in Pending Schedule Approval and the record's own table.
      qc.invalidateQueries({ queryKey: VISIT_KEYS[o.table] })
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      toast.success(t("visitDraftCreated", { type: t(o.jobType), date: formatDate(date) }))
    } catch (error) {
      toast.error(t("visitDraftFailed", { message: error instanceof Error ? error.message : String(error) }))
    }
  }
}
