"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { TruncatedCell, TruncatedContainer } from "@/components/shared/truncated-cell"
import { useTranslation } from "@/lib/i18n/i18n-context"
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

// One row per distinct customer (Member Account#) on the standalone
// /repair-plan list page — `records` is every repair_plans row for that
// member, across every order number they've ever had a repair under, most
// recent first, so records[0].issuedDate is always the latest one;
// latestDate just names that value so it can be its own real, sortable
// column property instead of something the cell recomputes on every render.
//
// repair_plans has no direct customer_id FK (confirmed by investigation —
// neither it nor install_plans has ever had one), so the member is resolved
// the same way the Add/Edit form's own autofill already does: first the
// order_no -> sale_list_entries.order_number -> customers bridge
// (customer-lookup.ts's findCustomerByOrderNumber), then — if that finds
// nothing — an exact Account Name match against an existing customer's own
// full/company name (findExistingMemberMatch, the same lookup that form's
// Account Name field already uses for autofill). memberAccountNumber is
// left undefined when NEITHER resolves (no matching order, no matching
// name, or a matched customer with no member account number assigned yet)
// — those records fall back to being grouped by their own (normalized)
// Account Name text instead of being silently dropped, merged into an
// unrelated member, or left as separate rows per order; see
// repair-plan/page.tsx's own orderGroups for exactly how that split works.
//
// Built by repair-plan/page.tsx, not read from any API directly (there's no
// real "order"/"member repair summary" table to query) — always derived
// fresh from whatever repair_plans/sale_list_entries/customers rows
// currently exist, never a stored value that could drift out of date.
export interface RepairOrderGroup {
  id: string
  memberAccountNumber?: string
  accountName: string
  latestDate: string
  records: RepairPlan[]
  // Every order number that should find this group by search — each
  // record's own orderNo plus the linked customer's own order_number when
  // resolved, space-joined. Never rendered as a column: `records` is an
  // array of objects, which DataTable's generic Object.values() search
  // can't see into at all, so without this field order-number search on
  // this list was completely blind to every repair record.
  orderNumbers: string
}

function MemberAccountCell({ group }: { group: RepairOrderGroup }) {
  const { t } = useTranslation("repair")
  if (group.memberAccountNumber) {
    return <span className="font-mono text-sm">{group.memberAccountNumber}</span>
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {t("noMemberAccount")}
    </Badge>
  )
}

// The standalone /repair-plan list page's own columns — deliberately just
// these three (Account Name, Member Account#, Latest Repair Date), one row
// per distinct member rather than one per order or per repair visit.
// Clicking a row (via DataTable's own onRowClick, same as every other list
// page here — no per-cell handler needed since every column should behave
// the same way) drills into that member's own list of repair dates across
// every order instead of opening a single record's detail panel directly;
// see repair-plan/page.tsx's own onRowClick={orderSelection.open}.
export function getRepairOrderGroupColumns(): ColumnDef<RepairOrderGroup, unknown>[] {
  return [
    {
      accessorKey: "accountName",
      header: () => <ColumnHeader tKey="accountName" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.accountName} />,
    },
    {
      accessorKey: "memberAccountNumber",
      header: () => <ColumnHeader tKey="memberAccount" ns="fields" />,
      cell: ({ row }) => <MemberAccountCell group={row.original} />,
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
