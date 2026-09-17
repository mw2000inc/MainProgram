"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { InlineSelectCell } from "@/components/shared/inline-edit-cell"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { TruncatedCell, TruncatedContainer } from "@/components/shared/truncated-cell"
import { useTranslation } from "@/lib/i18n/i18n-context"
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

// One row per distinct customer (Member Account#) on the standalone
// /install list page — `records` is every install_plans row for that
// customer, across every order they've ever had an install under, most
// recent first, so records[0].inputDate is always the latest one;
// latestDate just names that value so it can be its own real, sortable
// column property instead of something the cell recomputes on every render.
//
// Exact same resolution shape as RepairOrderGroup (see repair-columns.tsx's
// own comment) — install_plans has no direct customer_id FK either, so this
// is resolved the same way: order_no -> sale_list_entries -> customers
// first (findCustomerByOrderNumber), then a name/phone match against an
// existing customer (findExistingMemberMatch) if that finds nothing. Phone
// is included here (unlike Repair's own fallback, which is name-only) —
// checked live against production data before deciding: 0 of 13 real
// install_plans rows have a resolvable order number today, and Install's
// own `name` field is typed per install *site* rather than per account
// (e.g. "Maxicare_DD Meridian" and "Maxicare_Centris" are the same member's
// two different install locations), so a name-only fallback would leave
// obviously-duplicate real records unmerged. Phone triples the real match
// rate and is what actually merges that Maxicare example into one group.
//
// Built by install/page.tsx, not read from any API directly (there's no
// real "order"/"member install summary" table to query) — always derived
// fresh from whatever install_plans/sale_list_entries/customers rows
// currently exist, never a stored value that could drift out of date.
export interface InstallOrderGroup {
  id: string
  memberAccountNumber?: string
  name: string
  latestDate: string
  records: InstallPlan[]
  // Every order number that should find this group by search — each
  // record's own orderNo plus the linked customer's own order_number when
  // resolved, space-joined. Never rendered as a column: `records` is an
  // array of objects, which DataTable's generic Object.values() search
  // can't see into at all, so without this field order-number search on
  // this list would be completely blind to every install record (same fix
  // already applied to RepairOrderGroup).
  orderNumbers: string
  // records[0] (same record latestDate/name are already pulled from) —
  // exposed as its own object rather than flattening another dozen fields
  // onto this interface, since getInstallOrderGroupColumns' AppSheet-style
  // column set below reads straight from it. Only ever a display source:
  // clicking the row still drills into every one of this member's records
  // via `records`, not just this latest one.
  latest: InstallPlan
}

function MemberAccountCell({ group }: { group: InstallOrderGroup }) {
  const { t } = useTranslation("install")
  if (group.memberAccountNumber) {
    return <span className="font-mono text-sm">{group.memberAccountNumber}</span>
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {t("noMemberAccount")}
    </Badge>
  )
}

// The standalone /install list page's own columns — one row per distinct
// member rather than one per order or per install record. Beyond the two
// group-level columns (Member Account#, Latest Install Date), every other
// column is AppSheet-parity display only: sourced from `latest` (that
// member's most recent install record — the exact same record latestDate
// itself came from), never from `records` as a whole. Clicking a row (via
// DataTable's own onRowClick, same as every other list page here — no
// per-cell handler needed since every column should behave the same way)
// still drills into that member's own list of every install date, not just
// the one shown here; see install/page.tsx's own onRowClick={orderSelection.open}.
export function getInstallOrderGroupColumns(): ColumnDef<InstallOrderGroup, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: () => <ColumnHeader tKey="name" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.name} />,
    },
    {
      accessorKey: "memberAccountNumber",
      header: () => <ColumnHeader tKey="memberAccount" ns="fields" />,
      cell: ({ row }) => <MemberAccountCell group={row.original} />,
    },
    {
      accessorKey: "latestDate",
      header: () => <ColumnHeader tKey="latestInstallDate" ns="fields" />,
      cell: ({ row }) => formatDate(row.original.latestDate),
    },
    {
      id: "latestInputDate",
      header: () => <ColumnHeader tKey="inputDate" ns="fields" />,
      cell: ({ row }) => formatDate(row.original.latest.inputDate),
    },
    {
      id: "latestOrderNo",
      header: () => <ColumnHeader tKey="orderNo" ns="fields" />,
      cell: ({ row }) => row.original.latest.orderNo || "—",
    },
    {
      id: "latestAddress",
      header: () => <ColumnHeader tKey="address" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.latest.address} />,
    },
    {
      id: "latestContactNumber",
      header: () => <ColumnHeader tKey="contactNumber" ns="fields" />,
      cell: ({ row }) => row.original.latest.contactNumber || "—",
    },
    {
      id: "latestInOut",
      header: () => <ColumnHeader tKey="inOrOut" ns="fields" />,
      cell: ({ row }) => row.original.latest.inOut || "—",
    },
    {
      id: "latestModelDp",
      header: () => <ColumnHeader tKey="modelDp" ns="fields" />,
      cell: ({ row }) => row.original.latest.modelDp || "—",
    },
    {
      id: "latestModel",
      header: () => <ColumnHeader tKey="model" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.latest.model} />,
    },
    {
      id: "latestUnitPrice",
      header: () => <ColumnHeader tKey="unitPrice" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.latest.unitPrice),
    },
    {
      id: "latestCpPrice",
      header: () => <ColumnHeader tKey="cpPrice" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.latest.cpPrice),
    },
    {
      id: "latestDeliveryInstallationFee",
      header: () => <ColumnHeader tKey="deliveryInstallationFee" ns="fields" />,
      cell: ({ row }) => formatCurrency(row.original.latest.deliveryInstallationFee),
    },
    {
      id: "latestPaymentMode",
      header: () => <ColumnHeader tKey="paymentMode" ns="fields" />,
      cell: ({ row }) => row.original.latest.paymentMode || "—",
    },
    {
      id: "latestPreInstalledDate",
      header: () => <ColumnHeader tKey="preInstalledDate" ns="fields" />,
      cell: ({ row }) => (row.original.latest.preInstalledDate ? formatDate(row.original.latest.preInstalledDate) : "—"),
    },
    {
      id: "latestInstalledDate",
      header: () => <ColumnHeader tKey="installedDate" ns="fields" />,
      cell: ({ row }) => (row.original.latest.installedDate ? formatDate(row.original.latest.installedDate) : "—"),
    },
    {
      id: "latestNote",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      cell: ({ row }) => <NoteCell plan={row.original.latest} />,
    },
    {
      id: "latestServiceman",
      header: () => <ColumnHeader tKey="serviceman" ns="fields" />,
      cell: ({ row }) => row.original.latest.serviceman || "—",
    },
    {
      id: "latestStatus",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <PlanStatusBadge status={row.original.latest.status} />,
    },
  ]
}

// The narrow date-picker list shown once a member is drilled into (see
// InstallOrderGroup above) — same "single identifying column, row click
// selects it" shape as getRepairDateColumns' own narrow list. Selecting a
// date shows that one install visit's full detail panel (every field)
// alongside it, unchanged from before this drill-down existed.
export function getInstallDateColumns(): ColumnDef<InstallPlan, unknown>[] {
  return [
    {
      accessorKey: "inputDate",
      header: () => <ColumnHeader tKey="inputDate" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{formatDate(row.original.inputDate)}</span>,
    },
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
