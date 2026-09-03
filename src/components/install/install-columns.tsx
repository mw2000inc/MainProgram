"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { InstallPlan } from "@/lib/types"

export const INSTALL_STATUS_OPTIONS = ["Pending", "Completed", "Cancelled"] as const

function NoteCell({ plan }: { plan: InstallPlan }) {
  if (!plan.note) return <span className="text-muted-foreground">—</span>
  return (
    <TranslatableText entityType="install_plans" entityId={plan.id} fieldName="note" text={plan.note} className="text-muted-foreground" />
  )
}

// A single interactive Status column when onStatusChange is provided
// (Daily Report + the standalone /install page, admin-only) — same pattern
// as Filter Change/Collection/Repair. Falls back to the plain read-only
// badge everywhere else this column set is used.
function StatusCell({ plan, onStatusChange }: { plan: InstallPlan; onStatusChange?: (plan: InstallPlan, status: string) => void }) {
  if (!onStatusChange) return <PlanStatusBadge status={plan.status} />
  return (
    <PlanStatusSelect status={plan.status} options={INSTALL_STATUS_OPTIONS} onChange={(next) => onStatusChange(plan, next)} />
  )
}

// Compact dashboard view — trimmed of Input Date, Sales Person, Via, Year Month
// Plan, Model(dp), and Delivery & Installation Fee to keep the daily glance
// focused (all still captured on Add / available via export where applicable).
export function getInstallColumns({
  onStatusChange,
}: {
  onStatusChange?: (plan: InstallPlan, status: string) => void
} = {}): ColumnDef<InstallPlan, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: () => <ColumnHeader tKey="name" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    { accessorKey: "orderNo", header: () => <ColumnHeader tKey="orderNo" ns="fields" /> },
    { accessorKey: "address", header: () => <ColumnHeader tKey="address" ns="fields" /> },
    { accessorKey: "contactNumber", header: () => <ColumnHeader tKey="contactNumber" ns="fields" /> },
    { accessorKey: "inOut", header: () => <ColumnHeader tKey="inOrOut" ns="fields" /> },
    { accessorKey: "model", header: () => <ColumnHeader tKey="model" ns="fields" /> },
    {
      accessorKey: "unitPrice",
      header: () => <ColumnHeader tKey="unitPrice" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.unitPrice),
    },
    {
      accessorKey: "cpPrice",
      header: () => <ColumnHeader tKey="cpPrice" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.cpPrice),
    },
    {
      accessorKey: "preInstalledDate",
      header: () => <ColumnHeader tKey="preInstalledDate" ns="fields" />,
      cell: ({ row }) => (row.original.preInstalledDate ? formatDate(row.original.preInstalledDate) : "—"),
    },
    {
      accessorKey: "installedDate",
      header: () => <ColumnHeader tKey="installedDate" ns="fields" />,
      cell: ({ row }) => (row.original.installedDate ? formatDate(row.original.installedDate) : "—"),
    },
    {
      accessorKey: "note",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      cell: ({ row }) => <NoteCell plan={row.original} />,
    },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  ]
}

// Full column set for the standalone /install list page — every field, unlike
// the trimmed dashboard-panel view above.
export function getInstallFullColumns({
  canDelete,
  onDelete,
  onStatusChange,
}: {
  canDelete: boolean
  onDelete: (plan: InstallPlan) => void
  onStatusChange?: (plan: InstallPlan, status: string) => void
}): ColumnDef<InstallPlan, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: () => <ColumnHeader tKey="name" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    { accessorKey: "orderNo", header: () => <ColumnHeader tKey="orderNo" ns="fields" /> },
    { accessorKey: "address", header: () => <ColumnHeader tKey="address" ns="fields" /> },
    { accessorKey: "contactNumber", header: () => <ColumnHeader tKey="contactNumber" ns="fields" /> },
    { accessorKey: "inOut", header: () => <ColumnHeader tKey="inOrOut" ns="fields" /> },
    { accessorKey: "model", header: () => <ColumnHeader tKey="model" ns="fields" /> },
    {
      accessorKey: "unitPrice",
      header: () => <ColumnHeader tKey="unitPrice" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.unitPrice),
    },
    {
      accessorKey: "cpPrice",
      header: () => <ColumnHeader tKey="cpPrice" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.cpPrice),
    },
    {
      accessorKey: "deliveryInstallationFee",
      header: () => <ColumnHeader tKey="deliveryInstallationFee" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.deliveryInstallationFee),
    },
    {
      accessorKey: "preInstalledDate",
      header: () => <ColumnHeader tKey="preInstalledDate" ns="fields" />,
      cell: ({ row }) => (row.original.preInstalledDate ? formatDate(row.original.preInstalledDate) : "—"),
    },
    {
      accessorKey: "installedDate",
      header: () => <ColumnHeader tKey="installedDate" ns="fields" />,
      cell: ({ row }) => (row.original.installedDate ? formatDate(row.original.installedDate) : "—"),
    },
    {
      accessorKey: "note",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      cell: ({ row }) => <NoteCell plan={row.original} />,
    },
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
            cell: ({ row }: { row: { original: InstallPlan } }) => (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-danger hover:text-danger"
                onClick={() => onDelete(row.original)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ),
          } satisfies ColumnDef<InstallPlan, unknown>,
        ]
      : []),
  ]
}

export const INSTALL_EXPORT_COLUMNS = [
  { header: "Input Date", key: "inputDate" },
  { header: "Name", key: "name" },
  { header: "Order No", key: "orderNo" },
  { header: "Address", key: "address" },
  { header: "Contact #", key: "contactNumber" },
  { header: "In or Out", key: "inOut" },
  { header: "Model", key: "model" },
  { header: "Unit Price", key: "unitPrice" },
  { header: "C/P Price", key: "cpPrice" },
  { header: "Delivery & Installation Fee", key: "deliveryInstallationFee" },
  { header: "Pre Installed Date", key: "preInstalledDate" },
  { header: "Installed Date", key: "installedDate" },
  { header: "Note", key: "note" },
  { header: "Model(dp)", key: "modelDp" },
  { header: "Status", key: "status" },
]
