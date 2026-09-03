"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { RepairPlan } from "@/lib/types"

export const REPAIR_STATUS_OPTIONS = ["Pending", "Completed", "Cancelled"] as const

function ProblemCell({ plan }: { plan: RepairPlan }) {
  if (!plan.problem) return <span className="text-muted-foreground">—</span>
  return (
    <TranslatableText entityType="repair_plans" entityId={plan.id} fieldName="problem" text={plan.problem} className="text-muted-foreground" />
  )
}

function SolutionStatusCell({ plan }: { plan: RepairPlan }) {
  if (!plan.solutionStatus) return <span className="text-muted-foreground">—</span>
  return (
    <TranslatableText
      entityType="repair_plans"
      entityId={plan.id}
      fieldName="solution_status"
      text={plan.solutionStatus}
      className="text-muted-foreground"
    />
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
      cell: ({ row }) => <span className="font-medium">{row.original.accountName}</span>,
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

// Full column set for the standalone /repair-plan list page — every field,
// unlike the trimmed dashboard-panel view above.
export function getRepairFullColumns({
  canDelete,
  onDelete,
  onStatusChange,
}: {
  canDelete: boolean
  onDelete: (plan: RepairPlan) => void
  onStatusChange?: (plan: RepairPlan, status: string) => void
}): ColumnDef<RepairPlan, unknown>[] {
  return [
    {
      accessorKey: "accountName",
      header: () => <ColumnHeader tKey="accountName" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.accountName}</span>,
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
    ...(canDelete
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: RepairPlan } }) => (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-danger hover:text-danger"
                onClick={() => onDelete(row.original)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ),
          } satisfies ColumnDef<RepairPlan, unknown>,
        ]
      : []),
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
