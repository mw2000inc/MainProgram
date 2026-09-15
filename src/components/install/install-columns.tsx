"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { InlineSelectCell } from "@/components/shared/inline-edit-cell"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { TruncatedCell, TruncatedContainer } from "@/components/shared/truncated-cell"
import { formatCurrency, formatDate } from "@/lib/utils"
import { TECHNICIANS } from "@/lib/constants"
import type { InstallPlan } from "@/lib/types"

export const INSTALL_STATUS_OPTIONS = ["Pending", "Completed", "Cancelled"] as const

function NoteCell({ plan }: { plan: InstallPlan }) {
  if (!plan.note) return <span className="text-muted-foreground">—</span>
  return (
    <TruncatedContainer text={plan.note}>
      <TranslatableText
        entityType="install_plans"
        entityId={plan.id}
        fieldName="note"
        text={plan.note}
        className="truncate text-muted-foreground"
      />
    </TruncatedContainer>
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
  onFieldChange,
}: {
  onStatusChange?: (plan: InstallPlan, status: string) => void
  // Admin-only, same on/off convention onStatusChange already uses —
  // undefined (non-admin) falls the serviceman cell below back to plain
  // read-only text. Only serviceman for now; widen this Pick if another
  // field here ever needs the same inline-edit treatment.
  onFieldChange?: (plan: InstallPlan, patch: Partial<Pick<InstallPlan, "serviceman">>) => void
} = {}): ColumnDef<InstallPlan, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: () => <ColumnHeader tKey="name" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.name} className="font-medium" />,
    },
    { accessorKey: "orderNo", header: () => <ColumnHeader tKey="orderNo" ns="fields" /> },
    {
      accessorKey: "address",
      header: () => <ColumnHeader tKey="address" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.address} />,
    },
    { accessorKey: "contactNumber", header: () => <ColumnHeader tKey="contactNumber" ns="fields" /> },
    { accessorKey: "inOut", header: () => <ColumnHeader tKey="inOrOut" ns="fields" /> },
    {
      accessorKey: "model",
      header: () => <ColumnHeader tKey="model" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.model} />,
    },
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
    // Inline-editable, same TECHNICIANS-roster Select Filter Change's own
    // Daily Report serviceman column uses — this field previously had no
    // table anywhere it could even be set outside the Pending Approvals
    // edit dialog, despite existing on install_plans since the
    // 20260914000000 migration.
    {
      accessorKey: "serviceman",
      header: () => <ColumnHeader tKey="serviceman" ns="fields" />,
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange) return <span className="inline-block min-w-37.5">{plan.serviceman || "—"}</span>
        return (
          <InlineSelectCell
            value={plan.serviceman}
            options={TECHNICIANS}
            onCommit={(next) => onFieldChange(plan, { serviceman: next })}
          />
        )
      },
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
      cell: ({ row }) => <TruncatedCell value={row.original.name} className="font-medium" />,
    },
    { accessorKey: "orderNo", header: () => <ColumnHeader tKey="orderNo" ns="fields" /> },
    {
      accessorKey: "address",
      header: () => <ColumnHeader tKey="address" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.address} />,
    },
    { accessorKey: "contactNumber", header: () => <ColumnHeader tKey="contactNumber" ns="fields" /> },
    { accessorKey: "inOut", header: () => <ColumnHeader tKey="inOrOut" ns="fields" /> },
    {
      accessorKey: "model",
      header: () => <ColumnHeader tKey="model" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.model} />,
    },
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
      accessorKey: "serviceman",
      header: () => <ColumnHeader tKey="serviceman" ns="fields" />,
      cell: ({ row }) => row.original.serviceman || "—",
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
  { header: "Serviceman", key: "serviceman" },
  { header: "Status", key: "status" },
]
