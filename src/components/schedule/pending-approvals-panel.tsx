"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { StatusBadge, type BadgeTone } from "@/components/shared/status-badge"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { computeStopNumbers, formatTechnicians } from "@/components/schedule/schedule-columns"
import { ApprovalDetailDialog } from "@/components/schedule/approval-detail-dialog"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"
import type { Customer, SaleListEntry, ScheduleJob } from "@/lib/types"
import type { DispatchEntityType } from "@/lib/api/dispatch-confirmation"

// One row per dispatch item genuinely awaiting admin attention — Draft
// (never yet approved) or Reschedule Requested (customer-declined-with-a-
// new-date, OR an admin's own request_reschedule_by_admin — both land on
// this same dispatch_status, see that migration's own comment on why no
// second status was invented for the admin-initiated case). Confirmed and
// Rejected rows never appear here — this is deliberately the same
// dispatch_status this app already tracks, just a second, more focused
// surface for it than DispatchApprovalQueue's own Dashboard panel (which
// stays completely unchanged — this doesn't replace it, admins can use
// either).
export interface PendingApprovalRow {
  entityType: DispatchEntityType
  entityId: string
  moduleKey: "filterChangeModule" | "installationModule" | "collectionModule" | "repairModule"
  recordLabel: string
  orderNumber?: string
  customerName?: string
  customerEmail?: string
  scheduledDate: string
  requestedTime?: string
  dispatchStatus: "Draft" | "Reschedule Requested"
  technician?: string
  technician2?: string
  routeSequence?: number
  notes?: string
  remarks?: string
  rescheduleReason?: string
  createdAt: string
}

function findCustomer(
  customers: Customer[],
  saleListEntries: SaleListEntry[],
  { customerId, orderNumber }: { customerId?: string; orderNumber?: string }
): Customer | undefined {
  if (customerId) {
    const byId = customers.find((c) => c.id === customerId)
    if (byId) return byId
  }
  if (orderNumber) return findCustomerByOrderNumber(customers, saleListEntries, orderNumber)
  return undefined
}

function buildRows(
  filterChangePlans: ReturnType<typeof useFilterChangePlans>["data"],
  installPlans: ReturnType<typeof useInstallPlans>["data"],
  collections: ReturnType<typeof useCollections>["data"],
  repairPlans: ReturnType<typeof useRepairPlans>["data"],
  customers: Customer[],
  saleListEntries: SaleListEntry[],
  scheduleJobs: ScheduleJob[]
): PendingApprovalRow[] {
  const rows: PendingApprovalRow[] = []
  const jobById = new Map(scheduleJobs.map((j) => [j.id, j]))

  function withJob(scheduleJobId: string | undefined, base: Omit<PendingApprovalRow, "technician" | "technician2" | "routeSequence" | "remarks">): PendingApprovalRow {
    const job = scheduleJobId ? jobById.get(scheduleJobId) : undefined
    return {
      ...base,
      technician: job?.technician,
      technician2: job?.technician2,
      routeSequence: job?.routeSequence,
      remarks: job?.remarks,
      notes: base.notes ?? job?.notes,
    }
  }

  for (const p of filterChangePlans ?? []) {
    if (p.dispatchStatus !== "Draft" && p.dispatchStatus !== "Reschedule Requested") continue
    const customer = findCustomer(customers, saleListEntries, { customerId: p.customerId, orderNumber: p.orderNumber })
    rows.push(
      withJob(p.scheduleJobId, {
        entityType: "filter_change_plans",
        entityId: p.id,
        moduleKey: "filterChangeModule",
        recordLabel: p.memberAccount || p.orderNumber,
        orderNumber: p.orderNumber,
        customerName: customer?.fullName,
        customerEmail: p.notifyEmail ?? customer?.email,
        scheduledDate: p.preD || p.planDate,
        requestedTime: p.requestedTime,
        dispatchStatus: p.dispatchStatus,
        notes: p.note,
        rescheduleReason: p.rescheduleReason,
        createdAt: p.createdAt,
      })
    )
  }
  for (const p of installPlans ?? []) {
    if (p.dispatchStatus !== "Draft" && p.dispatchStatus !== "Reschedule Requested") continue
    const customer = findCustomer(customers, saleListEntries, { orderNumber: p.orderNo })
    rows.push(
      withJob(p.scheduleJobId, {
        entityType: "install_plans",
        entityId: p.id,
        moduleKey: "installationModule",
        recordLabel: p.name || p.orderNo,
        orderNumber: p.orderNo,
        customerName: customer?.fullName ?? p.name,
        customerEmail: p.notifyEmail ?? customer?.email,
        scheduledDate: p.preInstalledDate || p.inputDate,
        requestedTime: p.requestedTime,
        dispatchStatus: p.dispatchStatus,
        notes: p.note,
        rescheduleReason: p.rescheduleReason,
        createdAt: p.createdAt,
      })
    )
  }
  for (const c of collections ?? []) {
    if (c.dispatchStatus !== "Draft" && c.dispatchStatus !== "Reschedule Requested") continue
    const customer = findCustomer(customers, saleListEntries, { customerId: c.customerId, orderNumber: c.orderNo })
    rows.push(
      withJob(c.scheduleJobId, {
        entityType: "collections",
        entityId: c.id,
        moduleKey: "collectionModule",
        recordLabel: c.accountName || c.orderNo,
        orderNumber: c.orderNo,
        customerName: customer?.fullName,
        customerEmail: c.notifyEmail ?? customer?.email,
        scheduledDate: c.preD || c.collectionDate,
        requestedTime: c.requestedTime,
        dispatchStatus: c.dispatchStatus,
        notes: c.note,
        rescheduleReason: c.rescheduleReason,
        createdAt: c.createdAt,
      })
    )
  }
  for (const r of repairPlans ?? []) {
    if (r.dispatchStatus !== "Draft" && r.dispatchStatus !== "Reschedule Requested") continue
    const customer = findCustomer(customers, saleListEntries, { orderNumber: r.orderNo })
    rows.push(
      withJob(r.scheduleJobId, {
        entityType: "repair_plans",
        entityId: r.id,
        moduleKey: "repairModule",
        recordLabel: r.accountName || r.orderNo,
        orderNumber: r.orderNo,
        customerName: customer?.fullName,
        customerEmail: r.notifyEmail ?? customer?.email,
        scheduledDate: r.preD || r.issuedDate,
        requestedTime: r.requestedTime,
        dispatchStatus: r.dispatchStatus,
        rescheduleReason: r.rescheduleReason,
        createdAt: r.createdAt,
      })
    )
  }

  return rows.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
}

// Reuses the exact same 4 plan queries + customers + sale list entries
// DispatchApprovalQueue already loads (same react-query cache keys, so
// mounting both this and the Dashboard panel costs zero extra network
// calls) — this is a second, more focused *view* over the identical data,
// not a second data source.
export function usePendingApprovalRows(): { rows: PendingApprovalRow[]; isPending: boolean } {
  const { data: filterChangePlans, isPending: p1 } = useFilterChangePlans()
  const { data: installPlans, isPending: p2 } = useInstallPlans()
  const { data: collections, isPending: p3 } = useCollections()
  const { data: repairPlans, isPending: p4 } = useRepairPlans()
  const { data: customers = [], isPending: p5 } = useCustomers()
  const { data: saleListEntries = [], isPending: p6 } = useSaleListEntries()
  const { data: scheduleJobs = [], isPending: p7 } = useScheduleJobs()

  const rows = React.useMemo(
    () => buildRows(filterChangePlans, installPlans, collections, repairPlans, customers, saleListEntries, scheduleJobs),
    [filterChangePlans, installPlans, collections, repairPlans, customers, saleListEntries, scheduleJobs]
  )

  return { rows, isPending: p1 || p2 || p3 || p4 || p5 || p6 || p7 }
}

function PendingStatusBadge({ status }: { status: "Draft" | "Reschedule Requested" }) {
  const { t } = useTranslation("dispatch")
  const tone: BadgeTone = status === "Draft" ? "warning" : "warning"
  const label = status === "Draft" ? t("pendingApprovalStatus") : t("rescheduleRequested")
  return <StatusBadge tone={tone} label={label} />
}

export function PendingApprovalsPanel() {
  const { t } = useTranslation("dispatch")
  const { rows, isPending } = usePendingApprovalRows()
  const [reviewing, setReviewing] = React.useState<PendingApprovalRow | undefined>(undefined)

  const stopNumberByJobId = React.useMemo(
    () => computeStopNumbers(rows.filter((r) => r.routeSequence != null).map((r) => ({ id: r.entityId, technician: r.technician ?? "", scheduledDate: r.scheduledDate, routeSequence: r.routeSequence }))),
    [rows]
  )

  const columns: ColumnDef<PendingApprovalRow, unknown>[] = React.useMemo(
    () => [
      { accessorKey: "scheduledDate", header: t("dateColumn"), cell: ({ row }) => formatDate(row.original.scheduledDate) },
      { accessorKey: "moduleKey", header: t("jobTypeColumn"), cell: ({ row }) => t(row.original.moduleKey) },
      { accessorKey: "orderNumber", header: t("orderNoColumn"), cell: ({ row }) => row.original.orderNumber || "—" },
      { accessorKey: "customerName", header: t("customerColumn"), cell: ({ row }) => row.original.customerName || "—" },
      {
        accessorKey: "technician",
        header: t("technicianColumn"),
        cell: ({ row }) => (row.original.technician ? formatTechnicians(row.original.technician, row.original.technician2) : t("notAssigned")),
      },
      {
        id: "routeSequence",
        header: t("routeColumn"),
        cell: ({ row }) => {
          const n = stopNumberByJobId.get(row.original.entityId)
          return n != null ? t("routeStopShort", { n: String(n) }) : t("notAssigned")
        },
      },
      { accessorKey: "dispatchStatus", header: t("statusColumn"), cell: ({ row }) => <PendingStatusBadge status={row.original.dispatchStatus} /> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => setReviewing(row.original)}>
            {t("review")}
          </Button>
        ),
      },
    ],
    [t, stopNumberByJobId]
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
          data={rows}
          searchPlaceholder={t("searchPendingApprovals")}
          emptyMessage={t("noPendingApprovals")}
        />
      </CardContent>
      <ApprovalDetailDialog key={reviewing?.entityId ?? "none"} row={reviewing} onOpenChange={(open) => !open && setReviewing(undefined)} />
    </Card>
  )
}

// Purely the count for the tab label — a separate light hook (rather than
// requiring every consumer to pull the full row list) since the Schedule
// page's tab trigger needs only the number, computed from the exact same
// underlying queries/cache.
export function usePendingApprovalsCount(): number {
  const { rows } = usePendingApprovalRows()
  return rows.length
}
