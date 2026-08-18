"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { RepairPlan } from "@/lib/types"

// Compact dashboard view — trimmed of Issued Date and Part No (still captured on
// Add and available via export) to keep the daily glance focused.
export function getRepairColumns(): ColumnDef<RepairPlan, unknown>[] {
  return [
    {
      accessorKey: "accountName",
      header: "Account Name",
      cell: ({ row }) => <span className="font-medium">{row.original.accountName}</span>,
    },
    { accessorKey: "orderNo", header: "Order No" },
    { accessorKey: "unitInOut", header: "Unit IN/OUT" },
    {
      accessorKey: "problem",
      header: "Problem",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.problem || "—"}</span>,
    },
    {
      accessorKey: "solutionStatus",
      header: "Solution / Status",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.solutionStatus || "—"}</span>,
    },
    {
      accessorKey: "preD",
      header: "Pre D",
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    {
      accessorKey: "accD",
      header: "Acc D",
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    {
      accessorKey: "amt",
      header: "AMT",
      cell: ({ row }) => formatCurrency(row.original.amt),
    },
    { accessorKey: "th", header: "TH" },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <PlanStatusBadge status={row.original.status} />,
    },
  ]
}

// Full column set for the standalone /repair-plan list page — every field,
// unlike the trimmed dashboard-panel view above.
export function getRepairFullColumns({
  canDelete,
  onDelete,
}: {
  canDelete: boolean
  onDelete: (plan: RepairPlan) => void
}): ColumnDef<RepairPlan, unknown>[] {
  return [
    {
      accessorKey: "accountName",
      header: "Account Name",
      cell: ({ row }) => <span className="font-medium">{row.original.accountName}</span>,
    },
    { accessorKey: "orderNo", header: "Order No" },
    { accessorKey: "unitInOut", header: "Unit IN/OUT" },
    {
      accessorKey: "problem",
      header: "Problem",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.problem || "—"}</span>,
    },
    {
      accessorKey: "solutionStatus",
      header: "Solution / Status",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.solutionStatus || "—"}</span>,
    },
    {
      accessorKey: "preD",
      header: "Pre D",
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    {
      accessorKey: "accD",
      header: "Acc D",
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    {
      accessorKey: "amt",
      header: "AMT",
      cell: ({ row }) => formatCurrency(row.original.amt),
    },
    { accessorKey: "th", header: "TH" },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <PlanStatusBadge status={row.original.status} />,
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
