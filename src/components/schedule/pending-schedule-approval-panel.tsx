"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCheck } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { scheduleJobsKey, useScheduleJobs, useUpdateScheduleJob } from "@/lib/hooks/use-schedule"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useUsers } from "@/lib/hooks/use-misc"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { updateScheduleJob } from "@/lib/api/schedule"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { assignmentAccounts, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"
import { formatTechnicians, JOB_TYPE_LABELS } from "@/components/schedule/schedule-columns"
import { ScheduleFormDialog } from "@/components/schedule/schedule-form-dialog"
import { JobApprovalReview, type JobApprovalEdit } from "@/components/schedule/job-approval-review"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"
import type { ScheduleJob } from "@/lib/types"

// Admin Schedule Approval workflow — schedule_jobs rows still status =
// 'pending_approval': jobs an admin created manually (ScheduleFormDialog),
// automation drafts, and jobs created by a customer's confirmation (Step 2
// of the dispatch pipeline, 20261023000000_customer_confirm_creates_draft_job).
// This is a genuinely different concept than the Schedule page's other
// "Pending Approvals" tab (dispatch_status on filter_change_plans/
// install_plans/collections/repair_plans — items that don't have a
// schedule_jobs row *at all* yet): a row here already exists as a real
// schedule_jobs record, it's just not active/technician-visible until an
// admin approves it (see the schedule_pending_approval_status and
// schedule_pending_approval_rls_and_dedup migrations).
//
// RLS already does the real work of keeping a technician from ever reading
// these rows (schedule_jobs_select); this panel is reachable at all only
// because whoever's viewing it is already an admin (is_admin() bypasses
// that restriction entirely).
function usePendingScheduleApprovalJobs() {
  const { data: jobs = [], isPending } = useScheduleJobs()
  const pending = React.useMemo(() => jobs.filter((j) => j.status === "pending_approval"), [jobs])
  return { jobs: pending, isPending }
}

export function usePendingScheduleApprovalCount(): number {
  const { jobs } = usePendingScheduleApprovalJobs()
  return jobs.length
}

// Grouped by date, oldest first (so drafts already past their date are seen
// first), with "Approve all for <date>" on each date and "Approve all" above.
// Both open the Review & Edit dialog (JobApprovalReview): technicians,
// vehicle and notes editable, any job can be left out, nothing is approved
// until "Confirm & Approve". Approving only changes the job's status (plus
// whatever was edited), so the assignment is kept; the database then writes
// the job's date to the linked record's Pre D and confirms it (20261026,
// 20261028), which puts it on the Daily Report.
export function PendingScheduleApprovalPanel() {
  const { t } = useTranslation("schedule")
  const { t: tDispatch } = useTranslation("dispatch")
  const { jobs, isPending } = usePendingScheduleApprovalJobs()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { data: users = [] } = useUsers()
  const updateJob = useUpdateScheduleJob()
  const qc = useQueryClient()
  const [reviewing, setReviewing] = React.useState<ScheduleJob | undefined>(undefined)
  const [formOpen, setFormOpen] = React.useState(false)
  // The batch open in the Review & Edit dialog (one date's drafts, or all).
  const [batch, setBatch] = React.useState<ScheduleJob[] | null>(null)

  // Manually-created jobs have no dedicated "customer" field on this form
  // (schedule_jobs.customer_id is only ever populated by the dispatch-
  // confirm flow) — best-effort resolve one via the same order-number
  // lookup the dispatch Pending Approvals panel already uses, purely for
  // display here. Falls back to "—" when there's no order number, or none
  // matches, rather than guessing.
  function customerNameFor(job: ScheduleJob): string {
    if (job.customerId) {
      const byId = customers.find((c) => c.id === job.customerId)
      if (byId) return byId.fullName
    }
    if (job.orderNo) {
      const customer = findCustomerByOrderNumber(customers, saleListEntries, job.orderNo)
      if (customer) return customer.fullName
    }
    return "—"
  }

  function locationFor(job: ScheduleJob): string {
    if (job.secondaryAddress) return job.secondaryAddress
    if (job.customerId) {
      const byId = customers.find((c) => c.id === job.customerId)
      if (byId?.address) return byId.address
    }
    if (job.orderNo) {
      const customer = findCustomerByOrderNumber(customers, saleListEntries, job.orderNo)
      if (customer?.address) return customer.address
    }
    return "—"
  }

  async function quickApprove(job: ScheduleJob) {
    await updateJob.mutateAsync({ id: job.id, input: { status: "pending" } })
  }

  // Oldest date first; within a date, by technician then order number.
  const sorted = React.useMemo(
    () =>
      [...jobs].sort(
        (a, b) =>
          a.scheduledDate.localeCompare(b.scheduledDate) ||
          (a.technician ?? "").localeCompare(b.technician ?? "") ||
          (a.orderNo ?? "").localeCompare(b.orderNo ?? "")
      ),
    [jobs]
  )
  const jobsByDate = React.useMemo(() => {
    const map = new Map<string, ScheduleJob[]>()
    for (const j of sorted) map.set(j.scheduledDate, [...(map.get(j.scheduledDate) ?? []), j])
    return map
  }, [sorted])
  // The group header's label, and the date it stands for.
  const labelFor = React.useCallback(
    (date: string) => t("pendingGroupLabel", { date: formatDate(date, "EEE, MMM d, yyyy"), count: jobsByDate.get(date)?.length ?? 0 }),
    [t, jobsByDate]
  )
  const dateByLabel = React.useMemo(() => new Map([...jobsByDate.keys()].map((d) => [labelFor(d), d])), [jobsByDate, labelFor])

  // Approves the reviewed jobs with their edits, one at a time.
  async function approveBatch(items: { job: ScheduleJob; edit: JobApprovalEdit; changed: boolean }[]) {
    const accounts = assignmentAccounts(users)
    let approved = 0
    const failed: string[] = []
    for (const { job, edit, changed } of items) {
      const patch: Partial<ScheduleJob> = { status: "pending" }
      if (changed) {
        if (edit.primary !== (job.technician ?? "") || edit.secondary !== (job.technician2 ?? "")) {
          const pair = normalizeTechnicianPair(edit.primary, edit.secondary)
          Object.assign(patch, { technician: pair.primary, technician2: pair.secondary, ...technicianAccountIds(pair.primary, pair.secondary, accounts) })
        }
        if (edit.vehicle !== (job.vehicle ?? "")) patch.vehicle = edit.vehicle
        if (edit.notes !== (job.notes ?? "")) patch.notes = edit.notes
      }
      try {
        await updateScheduleJob(job.id, patch)
        approved += 1
      } catch (error) {
        failed.push(`${job.orderNo ?? job.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const queryKey of [scheduleJobsKey, filterChangePlansKey, installPlansKey, repairPlansKey, collectionsKey]) qc.invalidateQueries({ queryKey })
    if (approved) toast.success(t("draftsApproved", { count: approved }))
    if (failed.length) toast.error(t("bulkFailed", { count: failed.length, details: failed.slice(0, 3).join("; ") }))
  }

  const columns: ColumnDef<ScheduleJob, unknown>[] = React.useMemo(
    () => [
      { accessorKey: "scheduledDate", header: tDispatch("dateColumn"), cell: ({ row }) => formatDate(row.original.scheduledDate) },
      { accessorKey: "jobType", header: tDispatch("jobTypeColumn"), cell: ({ row }) => JOB_TYPE_LABELS[row.original.jobType] },
      { accessorKey: "orderNo", header: tDispatch("orderNoColumn"), cell: ({ row }) => row.original.orderNo || "—" },
      { id: "customer", header: tDispatch("customerColumn"), cell: ({ row }) => customerNameFor(row.original) },
      { id: "location", header: t("locationColumn"), cell: ({ row }) => locationFor(row.original) },
      {
        accessorKey: "technician",
        header: tDispatch("technicianColumn"),
        cell: ({ row }) => (row.original.technician ? formatTechnicians(row.original.technician, row.original.technician2) : tDispatch("notAssigned")),
      },
      { accessorKey: "vehicle", header: t("tableVehicle"), cell: ({ row }) => row.original.vehicle || "—" },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReviewing(row.original)
                setFormOpen(true)
              }}
            >
              {tDispatch("review")}
            </Button>
            <Button size="sm" disabled={updateJob.isPending} onClick={() => quickApprove(row.original)}>
              {t("approveSchedule")}
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tDispatch, customers, saleListEntries, updateJob.isPending]
  )

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <DataTable
          columns={columns}
          data={sorted}
          searchPlaceholder={t("searchByTechnicianOrderNotes")}
          emptyMessage={t("noPendingScheduleApprovals")}
          pageSize={Math.max(sorted.length, 1)}
          groupBy={(job) => labelFor(job.scheduledDate)}
          groupHeaderAction={(label) => {
            const date = dateByLabel.get(label)
            const dayJobs = date ? (jobsByDate.get(date) ?? []) : []
            return (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs font-medium"
                disabled={dayJobs.length === 0}
                onClick={() => setBatch(dayJobs)}
                data-testid="pending-approve-date"
              >
                <CheckCheck className="h-3.5 w-3.5" /> {t("draftsApproveDay", { date: date ? formatDate(date, "MMM d") : "", count: dayJobs.length })}
              </Button>
            )
          }}
          toolbar={
            sorted.length > 0 ? (
              <Button size="sm" className="h-9 gap-1.5" onClick={() => setBatch(sorted)} data-testid="pending-approve-all">
                <CheckCheck className="h-4 w-4" /> {t("approveAllPending", { count: sorted.length })}
              </Button>
            ) : undefined
          }
        />
      </CardContent>
      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setReviewing(undefined)
        }}
        defaultDate={reviewing?.scheduledDate ?? ""}
        job={reviewing}
      />
      <JobApprovalReview
        open={!!batch}
        onOpenChange={(o) => !o && setBatch(null)}
        jobs={batch ?? []}
        customerName={(job) => {
          const name = customerNameFor(job)
          return name === "—" ? undefined : name
        }}
        jobTypeLabel={(job) => JOB_TYPE_LABELS[job.jobType]}
        onConfirm={approveBatch}
      />
    </Card>
  )
}
