"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { useScheduleJobs, useUpdateScheduleJob } from "@/lib/hooks/use-schedule"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { formatTechnicians, JOB_TYPE_LABELS } from "@/components/schedule/schedule-columns"
import { ScheduleFormDialog } from "@/components/schedule/schedule-form-dialog"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"
import type { ScheduleJob } from "@/lib/types"

// Admin Schedule Approval workflow — schedule_jobs rows an admin manually
// created (ScheduleFormDialog) that are still status = 'pending_approval'.
// This is a genuinely different concept than the Schedule page's other
// "Pending Approvals" tab (dispatch_status on filter_change_plans/
// install_plans/collections/repair_plans — items that don't have a
// schedule_jobs row *at all* yet): a row here already exists as a real
// schedule_jobs record, it's just not active/technician-visible until an
// admin approves it (see the schedule_pending_approval_status and
// schedule_pending_approval_rls_and_dedup migrations). Smart Scheduling
// and the dispatch-confirm flow never produce a 'pending_approval' row —
// only this admin-manual path does — so this list is never populated by
// anything but a human admin's own "Schedule Job" creation.
//
// RLS already does the real work of keeping a technician from ever reading
// these rows (schedule_jobs_select); this panel is reachable at all only
// because whoever's viewing it is already an admin (is_admin() bypasses
// that restriction entirely).
export function usePendingScheduleApprovalJobs(): { jobs: ScheduleJob[]; isPending: boolean } {
  const { data: jobs = [], isPending } = useScheduleJobs()
  const pending = React.useMemo(() => jobs.filter((j) => j.status === "pending_approval"), [jobs])
  return { jobs: pending, isPending }
}

export function usePendingScheduleApprovalCount(): number {
  const { jobs } = usePendingScheduleApprovalJobs()
  return jobs.length
}

export function PendingScheduleApprovalPanel() {
  const { t } = useTranslation("schedule")
  const { t: tDispatch } = useTranslation("dispatch")
  const { jobs, isPending } = usePendingScheduleApprovalJobs()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const updateJob = useUpdateScheduleJob()
  const [reviewing, setReviewing] = React.useState<ScheduleJob | undefined>(undefined)
  const [formOpen, setFormOpen] = React.useState(false)

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
        <DataTable columns={columns} data={jobs} searchPlaceholder={t("searchByTechnicianOrderNotes")} emptyMessage={t("noPendingScheduleApprovals")} />
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
    </Card>
  )
}
