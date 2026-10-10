"use client"

import type { ColumnDef, SortingFn } from "@tanstack/react-table"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { TruncatedCell, TruncatedContainer } from "@/components/shared/truncated-cell"
import { formatCurrency, formatDate } from "@/lib/utils"
import { formatTechnicians } from "@/components/schedule/schedule-columns"
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
    {
      accessorKey: "th",
      header: () => <ColumnHeader tKey="th" ns="fields" />,
      cell: ({ row }) => (row.original.th ? formatTechnicians(row.original.th, row.original.th2, "&") : "—"),
    },
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
// The Repair Plan page's list: one row per repair (AppSheet's Repair list).
// S/C, Unit IN/OUT, Amount and Solution/Status are left to the repair's
// detail view. `partsByRepairId` is each repair's parts summary text
// ("013 ×1, 012 ×2 IN") — built once on the page, so these columns stay
// stable between renders.
export function getRepairListColumns(partsByRepairId: Map<string, string>): ColumnDef<RepairPlan, unknown>[] {
  // Sorting reads trimmed, case-insensitive text (a few account names start
  // with a space); a blank sorts after every value, so the first click
  // (ascending) leaves blanks at the bottom. (The table's own sortUndefined
  // "last" is inconsistent when both values are blank — on a mostly-blank
  // column like Parts it scrambles the order — so it isn't used.)
  const sortable = (value: string | undefined) => value?.trim() ?? ""
  const blanksAfter: SortingFn<RepairPlan> = (a, b, id) => {
    const x = String(a.getValue(id) ?? "").toLowerCase()
    const y = String(b.getValue(id) ?? "").toLowerCase()
    if (x === y) return 0
    if (!x) return 1
    if (!y) return -1
    return x < y ? -1 : 1
  }
  const sorting = { sortingFn: blanksAfter, sortDescFirst: false }
  return [
    {
      accessorKey: "issuedDate",
      header: () => <ColumnHeader tKey="issuedDate" ns="fields" />,
      meta: { headerClassName: "w-[110px]", cellClassName: "w-[110px] whitespace-nowrap" },
      cell: ({ row }) => (row.original.issuedDate ? formatDate(row.original.issuedDate) : "—"),
    },
    {
      id: "accountName",
      accessorFn: (plan) => sortable(plan.accountName),
      ...sorting,
      header: () => <ColumnHeader tKey="accountName" ns="fields" />,
      meta: { headerClassName: "w-[200px]", cellClassName: "w-[200px] max-w-[200px]" },
      cell: ({ row }) => <TruncatedCell value={row.original.accountName} className="font-medium" />,
    },
    {
      id: "orderNo",
      accessorFn: (plan) => sortable(plan.orderNo),
      ...sorting,
      header: () => <ColumnHeader tKey="orderNo" ns="fields" />,
      meta: { headerClassName: "w-[100px]", cellClassName: "w-[100px] whitespace-nowrap" },
      cell: ({ row }) => row.original.orderNo || "—",
    },
    {
      id: "model",
      accessorFn: (plan) => sortable(plan.model),
      ...sorting,
      header: () => <ColumnHeader tKey="model" ns="fields" />,
      meta: { headerClassName: "w-[120px]", cellClassName: "w-[120px] max-w-[120px]" },
      cell: ({ row }) => <TruncatedCell value={row.original.model || "—"} />,
    },
    {
      id: "problem",
      accessorFn: (plan) => sortable(plan.problem),
      ...sorting,
      header: () => <ColumnHeader tKey="problem" ns="fields" />,
      meta: { headerClassName: "w-[260px]", cellClassName: "w-[260px] max-w-[260px]" },
      cell: ({ row }) => <ProblemCell plan={row.original} />,
    },
    {
      id: "preD",
      accessorFn: (plan) => plan.preD ?? "",
      ...sorting,
      header: () => <ColumnHeader tKey="preD" ns="fields" />,
      meta: { headerClassName: "w-[110px]", cellClassName: "w-[110px] whitespace-nowrap" },
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    {
      id: "accD",
      accessorFn: (plan) => plan.accD ?? "",
      ...sorting,
      header: () => <ColumnHeader tKey="accD" ns="fields" />,
      meta: { headerClassName: "w-[110px]", cellClassName: "w-[110px] whitespace-nowrap" },
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    {
      id: "th",
      accessorFn: (plan) => sortable(plan.th ? formatTechnicians(plan.th, plan.th2, "&") : ""),
      ...sorting,
      header: () => <ColumnHeader tKey="th" ns="fields" />,
      meta: { headerClassName: "w-[160px]", cellClassName: "w-[160px] max-w-[160px]" },
      cell: ({ getValue }) => <TruncatedCell value={(getValue() as string) || "—"} />,
    },
    {
      id: "parts",
      accessorFn: (plan) => sortable(partsByRepairId.get(plan.id)),
      ...sorting,
      header: () => <ColumnHeader tKey="parts" ns="fields" />,
      meta: { headerClassName: "w-[180px]", cellClassName: "w-[180px] max-w-[180px]" },
      cell: ({ getValue }) => <TruncatedCell value={(getValue() as string) || "—"} />,
    },
  ]
}


// The Repair Plan search. Text that looks like an order number (digits, with
// or without dashes) matches the repair's Order No only: a complete number
// such as "001-0404" must match exactly (so it never finds 001-0405, nor
// 001-01036 when "001-0103" is typed); a partial one such as "0404" or
// "001-04" matches any Order No containing it. Any other text matches the
// account name or the problem. Case is ignored.
const FULL_ORDER_NO = /^\d{3}-\d{4,}$/
export function matchesRepairSearch(plan: RepairPlan, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (/^[\d-]+$/.test(q) && /\d/.test(q)) {
    const orderNo = plan.orderNo.trim().toLowerCase()
    return FULL_ORDER_NO.test(q) ? orderNo === q : orderNo.includes(q)
  }
  return plan.accountName.toLowerCase().includes(q) || (plan.problem ?? "").toLowerCase().includes(q)
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
  { header: "TH 2", key: "th2" },
  { header: "Part No", key: "partNo" },
  { header: "Status", key: "status" },
]
