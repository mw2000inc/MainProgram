"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { TruncatedCell, TruncatedContainer } from "@/components/shared/truncated-cell"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { RepairPlan } from "@/lib/types"

export const REPAIR_STATUS_OPTIONS = ["Pending", "Completed", "Cancelled"] as const

function ProblemCell({ plan }: { plan: RepairPlan }) {
  if (!plan.problem) return <span className="text-muted-foreground">—</span>
  return (
    <TruncatedContainer text={plan.problem}>
      <TranslatableText
        entityType="repair_plans"
        entityId={plan.id}
        fieldName="problem"
        text={plan.problem}
        className="truncate text-muted-foreground"
      />
    </TruncatedContainer>
  )
}

function SolutionStatusCell({ plan }: { plan: RepairPlan }) {
  if (!plan.solutionStatus) return <span className="text-muted-foreground">—</span>
  return (
    <TruncatedContainer text={plan.solutionStatus}>
      <TranslatableText
        entityType="repair_plans"
        entityId={plan.id}
        fieldName="solution_status"
        text={plan.solutionStatus}
        className="truncate text-muted-foreground"
      />
    </TruncatedContainer>
  )
}

// A single interactive Status column when onStatusChange is provided
// (Daily Report + the standalone /repair-plan page, admin-only) — same
// pattern as Filter Change/Collection/Installation. Falls back to the plain
// read-only badge everywhere else this column set is used.
function StatusCell({ plan, onStatusChange }: { plan: RepairPlan; onStatusChange?: (plan: RepairPlan, status: string) => void }) {
  if (!onStatusChange) return <PlanStatusBadge status={plan.status} />
  return (
    <PlanStatusSelect status={plan.status} options={REPAIR_STATUS_OPTIONS} onChange={(next) => onStatusChange(plan, next)} />
  )
}

// Compact dashboard view — trimmed of Issued Date and Part No (still captured on
// Add and available via export) to keep the daily glance focused.
export function getRepairColumns({
  onStatusChange,
}: {
  onStatusChange?: (plan: RepairPlan, status: string) => void
} = {}): ColumnDef<RepairPlan, unknown>[] {
  return [
    {
      accessorKey: "accountName",
      header: () => <ColumnHeader tKey="accountName" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.accountName} className="font-medium" />,
    },
    { accessorKey: "orderNo", header: () => <ColumnHeader tKey="orderNo" ns="fields" /> },
    { accessorKey: "unitInOut", header: () => <ColumnHeader tKey="unitInOut" ns="fields" /> },
    {
      accessorKey: "problem",
      header: () => <ColumnHeader tKey="problem" ns="fields" />,
      cell: ({ row }) => <ProblemCell plan={row.original} />,
    },
    {
      accessorKey: "solutionStatus",
      header: () => <ColumnHeader tKey="solutionStatus" ns="fields" />,
      cell: ({ row }) => <SolutionStatusCell plan={row.original} />,
    },
    {
      accessorKey: "preD",
      header: () => <ColumnHeader tKey="preD" ns="fields" />,
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    {
      accessorKey: "accD",
      header: () => <ColumnHeader tKey="accD" ns="fields" />,
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    {
      accessorKey: "amt",
      header: () => <ColumnHeader tKey="amt" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.amt),
    },
    { accessorKey: "th", header: () => <ColumnHeader tKey="th" ns="fields" /> },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  ]
}

// One row per distinct order_no on the standalone /repair-plan list page —
// `records` is every repair_plans row sharing that order (repeat visits),
// most recent first, so records[0].issuedDate is always the latest one;
// latestDate just names that value so it can be its own real, sortable
// column property instead of something the cell recomputes on every render.
// Built by repair-plan/page.tsx, not read from any API directly
// (repair_plans has no real "order" table of its own to query) — so it's
// always derived fresh from whatever repair_plans rows currently exist for
// that order, never a stored value that could drift out of date.
export interface RepairOrderGroup {
  id: string
  orderNo: string
  accountName: string
  latestDate: string
  records: RepairPlan[]
}

// The standalone /repair-plan list page's own columns — deliberately just
// these three (Order No, Customer Name, Latest Repair Date), one row per
// distinct order rather than one per repair visit. Clicking a row (via
// DataTable's own onRowClick, same as every other list page here — no
// per-cell handler needed since every column should behave the same way)
// drills into that order's own list of repair dates instead of opening a
// single record's detail panel directly; see repair-plan/page.tsx's own
// onRowClick={orderSelection.open}.
export function getRepairOrderGroupColumns(): ColumnDef<RepairOrderGroup, unknown>[] {
  return [
    {
      accessorKey: "orderNo",
      header: () => <ColumnHeader tKey="orderNo" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNo}</span>,
    },
    {
      accessorKey: "accountName",
      header: () => <ColumnHeader tKey="accountName" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.accountName} />,
    },
    {
      accessorKey: "latestDate",
      header: () => <ColumnHeader tKey="latestRepairDate" ns="fields" />,
      cell: ({ row }) => formatDate(row.original.latestDate),
    },
  ]
}

// The narrow date-picker list shown once an order is drilled into (see
// RepairOrderGroup above) — same "single identifying column, row click
// selects it" shape as getSaleListOrderNumberColumn's own narrow list for
// MemberOrderDetail. Selecting a date shows that one repair visit's full
// detail panel (every field) alongside it, unchanged from before this
// drill-down existed.
export function getRepairDateColumns(): ColumnDef<RepairPlan, unknown>[] {
  return [
    {
      accessorKey: "issuedDate",
      header: () => <ColumnHeader tKey="issuedDate" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{formatDate(row.original.issuedDate)}</span>,
    },
  ]
}

export const REPAIR_EXPORT_COLUMNS = [
  { header: "Issued Date", key: "issuedDate" },
  { header: "Account Name", key: "accountName" },
  { header: "Order No", key: "orderNo" },
  { header: "Unit IN/OUT", key: "unitInOut" },
  { header: "Problem", key: "problem" },
  { header: "Solution / Status", key: "solutionStatus" },
  { header: "Pre D", key: "preD" },
  { header: "Acc D", key: "accD" },
  { header: "AMT", key: "amt" },
  { header: "TH", key: "th" },
  { header: "Part No", key: "partNo" },
  { header: "Status", key: "status" },
]
