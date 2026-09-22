"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge, StatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { InlineDateCell, InlineGridPickerCell } from "@/components/shared/inline-edit-cell"
import { InlineTechnicianPairCell } from "@/components/shared/technician-combobox"
import { formatTechnicians } from "@/components/schedule/schedule-columns"
import { pairPatchToFields } from "@/lib/technicians"
import { useProducts } from "@/lib/hooks/use-inventory"
import { getFilterPartOptions } from "@/lib/filter-parts"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { TruncatedCell, TruncatedContainer } from "@/components/shared/truncated-cell"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { extractCityLabel } from "@/lib/geo/city-label"
import { formatDate } from "@/lib/utils"
import type { FilterChangePlan } from "@/lib/types"

// The linked customer's own "SK001-####" order_number, never rendered as a
// column — exists purely so DataTable's generic search on the standalone
// /filter-change list can find a plan by that number too, not just this
// plan's own "001-####" orderNumber (see filter-change/page.tsx's own
// row-building comment).
export type FilterChangeRow = FilterChangePlan & { customerOrderNumber: string }

// The plain address string, plus a best-effort recognized-area label
// underneath (see city-label.ts) — the closest thing this table has to a
// "location at a glance" column, since filter_change_plans has no
// structured city field of its own. Only the address line itself is
// truncated (the same free-text-with-no-length-limit problem every other
// wide column here has) — the recognized-area label is always short.
function AddressCell({ address }: { address: string }) {
  const city = extractCityLabel(address)
  return (
    <div>
      <TruncatedCell value={address} />
      {city && <div className="text-xs text-muted-foreground">{city}</div>}
    </div>
  )
}

function NoteCell({ plan }: { plan: FilterChangePlan }) {
  if (!plan.note) return <span className="text-muted-foreground">—</span>
  return (
    <TruncatedContainer text={plan.note}>
      <TranslatableText
        entityType="filter_change_plans"
        entityId={plan.id}
        fieldName="note"
        text={plan.note}
        className="truncate text-muted-foreground"
      />
    </TruncatedContainer>
  )
}

export const FILTER_CHANGE_STATUS_OPTIONS = ["Pending", "Completed", "Cancelled"] as const

// 'ct_completion' rows were auto-created/updated by a completed job
// recording its required filters (see the
// ct_filter_change_collection_inventory_link migration); 'recurring_schedule'
// rows were auto-generated from the sale list entry's Plan D — every 3
// months by default, or on the linked CP System's own shortest component
// interval once one is set (see the filter_change_recurring_schedule and
// filter_change_cp_system_interval migrations) — 'manual' (the default) is
// anything typed in directly on this page, same as always.
function SourceCell({ source }: { source: FilterChangePlan["source"] }) {
  const { t } = useTranslation("fields")
  if (source === "ct_completion") return <StatusBadge tone="secondary" label={t("autoCT")} />
  if (source === "recurring_schedule") return <StatusBadge tone="secondary" label={t("recurringSchedule")} />
  return <span className="text-muted-foreground">{t("manual")}</span>
}

// A single interactive Status column when onStatusChange is provided
// (Daily Report + the standalone /filter-change page, admin-only) —
// replaces the old read-only badge plus the separate one-click "Mark
// Filter Changed" button with one Select that both shows and changes
// status in place. Falls back to the plain read-only badge everywhere else
// this column set is used (Sale List, Member detail, the customer portal
// scan view), unchanged from before.
function StatusCell({ plan, onStatusChange }: { plan: FilterChangePlan; onStatusChange?: (plan: FilterChangePlan, status: string) => void }) {
  if (!onStatusChange) return <PlanStatusBadge status={plan.status} />
  return (
    <PlanStatusSelect
      status={plan.status}
      options={FILTER_CHANGE_STATUS_OPTIONS}
      onChange={(next) => onStatusChange(plan, next)}
    />
  )
}

export function getFilterChangeColumns({
  onStatusChange,
}: {
  onStatusChange?: (plan: FilterChangePlan, status: string) => void
} = {}): ColumnDef<FilterChangePlan, unknown>[] {
  return [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "memberAccount",
      header: () => <ColumnHeader tKey="memberAccount" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.memberAccount} />,
    },
    {
      accessorKey: "filterType",
      header: () => <ColumnHeader tKey="filter" ns="fields" />,
    },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  ]
}

// Effective scheduled date for a plan: preD (the real, admin-confirmed
// service date) when set, falling back to planDate (the auto-generated
// recurring slot) — same precedence the customer portal's own "Next
// Scheduled Filter Change" summary already uses (see customer-scan-view.tsx),
// kept in sync here so the table and that summary never disagree about what
// counts as "the" date for a given plan.
function scheduledDate(plan: FilterChangePlan): string {
  return plan.preD ?? plan.planDate
}

// Customer-facing variant of getFilterChangeColumns() above — Member
// Account# dropped (redundant: the portal is already scoped to one member's
// own record) in favor of a Scheduled Date column, so this stays a 4-column
// table that fits the same width budget without needing horizontal scroll
// on mobile. Read-only: no onStatusChange, matching every other portal
// table (collections/repairs) never letting a customer edit their own
// record.
export function getFilterChangeCustomerPortalColumns(): ColumnDef<FilterChangePlan, unknown>[] {
  return [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "filterType",
      header: () => <ColumnHeader tKey="filter" ns="fields" />,
    },
    {
      id: "scheduledDate",
      header: () => <ColumnHeader tKey="scheduledDate" ns="fields" />,
      cell: ({ row }) => formatDate(scheduledDate(row.original)),
    },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <PlanStatusBadge status={row.original.status} />,
    },
  ]
}

// Plan D (planDate) is deliberately not in this list: on a recurring row it's
// re-written by the sale-list sync, so the one-off-visit override is Pre D.
export type FilterChangeDailyReportPatch = Partial<Pick<FilterChangePlan, "preD" | "accD" | "serviceman" | "serviceman2" | "filterType">>

interface FilterChangeDailyReportColumnParams {
  onStatusChange?: (plan: FilterChangePlan, status: string) => void
  onFieldChange?: (plan: FilterChangePlan, patch: FilterChangeDailyReportPatch) => void
}

// Filter is a comma-separated list of inventory product SKUs ("012, 013") —
// the same products table the technician's job-completion filter picker and
// the Sale List's Product# dropdown read — so it's picked from a grid of those
// filter parts rather than typed. Named component (not inline in the column
// def) so it can call useProducts; the query is shared, so every row's cell
// reads the one cached fetch. Not required: an admin can clear it down to
// blank (e.g. before an install visit confirms which filters actually apply).
function FilterCell({
  plan,
  onFieldChange,
}: {
  plan: FilterChangePlan
  onFieldChange: (plan: FilterChangePlan, patch: FilterChangeDailyReportPatch) => void
}) {
  const { t } = useTranslation("filterChange")
  const { data: products = [] } = useProducts()
  const options = React.useMemo(() => getFilterPartOptions(products), [products])
  return (
    <InlineGridPickerCell
      value={plan.filterType}
      options={options}
      placeholder={t("filterPickerPlaceholder")}
      otherLabel={t("filterPickerOtherLabel")}
      doneLabel={t("filterPickerDone")}
      customPlaceholder={t("filterPickerCustomPlaceholder")}
      addLabel={t("filterPickerAddCustom")}
      onCommit={(next) => onFieldChange(plan, { filterType: next })}
    />
  )
}

// One column-def builder shared by the compact and expanded (Maximize2)
// variants below, keyed by field, so a cell's editing behavior/min-width
// only ever has to be defined once regardless of which of the two lists
// includes it. onFieldChange left undefined for a non-admin (see
// daily-report-section.tsx) falls every editable cell back to plain
// read-only text — same on/off convention onStatusChange already uses on
// this file's other column sets.
function dailyReportColumnDefs({
  onStatusChange,
  onFieldChange,
}: FilterChangeDailyReportColumnParams): Record<
  "orderNumber" | "memberAccount" | "filterType" | "contactNumber" | "address" | "planDate" | "preD" | "accD" | "serviceman" | "status",
  ColumnDef<FilterChangePlan, unknown>
> {
  return {
    orderNumber: {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[110px] font-medium">{row.original.orderNumber}</span>,
    },
    memberAccount: {
      accessorKey: "memberAccount",
      header: () => <ColumnHeader tKey="memberAccount" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[140px]">{row.original.memberAccount}</span>,
    },
    filterType: {
      accessorKey: "filterType",
      header: () => <ColumnHeader tKey="filter" ns="fields" />,
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange) return <span>{plan.filterType}</span>
        return <FilterCell plan={plan} onFieldChange={onFieldChange} />
      },
    },
    contactNumber: {
      accessorKey: "contactNumber",
      header: () => <ColumnHeader tKey="contactNumber" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[130px]">{row.original.contactNumber || "—"}</span>,
    },
    address: {
      accessorKey: "address",
      header: () => <ColumnHeader tKey="address" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[220px]">{row.original.address || "—"}</span>,
    },
    planDate: {
      accessorKey: "planDate",
      header: () => <ColumnHeader tKey="planD" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[100px]">{formatDate(row.original.planDate)}</span>,
    },
    preD: {
      accessorKey: "preD",
      header: () => <ColumnHeader tKey="preD" ns="fields" />,
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange) return <span className="inline-block min-w-[100px]">{plan.preD ? formatDate(plan.preD) : "—"}</span>
        return <InlineDateCell value={plan.preD} onCommit={(next) => onFieldChange(plan, { preD: next })} />
      },
    },
    accD: {
      accessorKey: "accD",
      header: () => <ColumnHeader tKey="accD" ns="fields" />,
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange) return <span className="inline-block min-w-[100px]">{plan.accD ? formatDate(plan.accD) : "—"}</span>
        return <InlineDateCell value={plan.accD} onCommit={(next) => onFieldChange(plan, { accD: next })} />
      },
    },
    serviceman: {
      accessorKey: "serviceman",
      header: () => <ColumnHeader tKey="serviceman" ns="fields" />,
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange) {
          return <span className="inline-block min-w-[150px]">{plan.serviceman ? formatTechnicians(plan.serviceman, plan.serviceman2, "&") : "—"}</span>
        }
        return (
          <InlineTechnicianPairCell
            primary={plan.serviceman}
            secondary={plan.serviceman2}
            onCommit={(patch) => onFieldChange(plan, pairPatchToFields(patch, { primary: "serviceman", secondary: "serviceman2" }))}
          />
        )
      },
    },
    status: {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  }
}

// The Daily Report's own compact Filter Change panel — exactly the 5
// fields an admin needs at a glance for today's dispatch (Order Number,
// Filter, Plan D, Pre D, Acc D), in that order. Every other field
// (Member Account#, Contact #, Address, Serviceman, Status) is deliberately
// held back for the Maximize2 full-screen view (see
// getFilterChangeDailyReportExpandedColumns below) rather than crammed in
// here scrollable — unlike the plain 4-column getFilterChangeColumns()
// above (reused read-only in several other places: Sale List, Member
// detail, the customer portal scan view), which this doesn't touch at all.
export function getFilterChangeDailyReportColumns(
  params: FilterChangeDailyReportColumnParams = {}
): ColumnDef<FilterChangePlan, unknown>[] {
  const c = dailyReportColumnDefs(params)
  return [c.orderNumber, c.filterType, c.planDate, c.preD, c.accD]
}

// The same panel's Maximize2 full-screen view — the compact 5 above, plus
// the 5 held back from it (Member Account#, Contact #, Address, Serviceman,
// Status), for the full 10-column set with horizontal scrolling. Shares
// the exact same cell renderers (and onFieldChange/onStatusChange editing)
// as the compact view via dailyReportColumnDefs, so switching to full-
// screen never loses the ability to edit Filter/Pre D/Acc D/Serviceman/Status.
export function getFilterChangeDailyReportExpandedColumns(
  params: FilterChangeDailyReportColumnParams = {}
): ColumnDef<FilterChangePlan, unknown>[] {
  const c = dailyReportColumnDefs(params)
  return [c.orderNumber, c.filterType, c.planDate, c.preD, c.accD, c.memberAccount, c.contactNumber, c.address, c.serviceman, c.status]
}

// Full AppSheet-parity column set, shown only in the panel's expanded view.
// Read-only unless onFieldChange is given — then Filter/Pre D/Acc D/Serviceman
// swap in the same inline cells the Daily Report columns use (see
// dailyReportColumnDefs), so the wider view of an editable table stays
// editable. Callers passing nothing (Sale List, the order page) get the plain
// cells below, unchanged.
export function getFilterChangeExpandedColumns(
  params: FilterChangeDailyReportColumnParams = {}
): ColumnDef<FilterChangePlan, unknown>[] {
  const editable = params.onFieldChange ? dailyReportColumnDefs(params) : undefined
  return [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    { accessorKey: "memberAccount", header: () => <ColumnHeader tKey="memberAccount" ns="fields" /> },
    editable?.filterType ?? { accessorKey: "filterType", header: () => <ColumnHeader tKey="filter" ns="fields" /> },
    { accessorKey: "contactNumber", header: () => <ColumnHeader tKey="contactNumber" ns="fields" /> },
    { accessorKey: "address", header: () => <ColumnHeader tKey="address" ns="fields" /> },
    { accessorKey: "sc", header: () => <ColumnHeader tKey="sc" ns="fields" /> },
    { accessorKey: "productNo", header: () => <ColumnHeader tKey="productNo" ns="fields" /> },
    editable?.preD ?? {
      accessorKey: "preD",
      header: () => <ColumnHeader tKey="preD" ns="fields" />,
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    editable?.accD ?? {
      accessorKey: "accD",
      header: () => <ColumnHeader tKey="accD" ns="fields" />,
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    editable?.serviceman ?? {
      accessorKey: "serviceman",
      header: () => <ColumnHeader tKey="serviceman" ns="fields" />,
      cell: ({ row }) => (row.original.serviceman ? formatTechnicians(row.original.serviceman, row.original.serviceman2, "&") : "—"),
    },
    {
      accessorKey: "source",
      header: () => <ColumnHeader tKey="source" ns="fields" />,
      cell: ({ row }) => <SourceCell source={row.original.source} />,
    },
    {
      accessorKey: "note",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      cell: ({ row }) => <NoteCell plan={row.original} />,
    },
  ]
}

// Standalone /filter-change page — matches the old AppSheet "MW CP > Filter
// Change" layout exactly (S/C and C/F intentionally excluded).
export function getFilterChangeFullColumns({
  canDelete,
  onDelete,
  onStatusChange,
}: {
  canDelete: boolean
  onDelete: (plan: FilterChangePlan) => void
  onStatusChange?: (plan: FilterChangePlan, status: string) => void
}): ColumnDef<FilterChangeRow, unknown>[] {
  const columns: ColumnDef<FilterChangeRow, unknown>[] = [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "memberAccount",
      header: () => <ColumnHeader tKey="memberAccount" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.memberAccount} />,
    },
    { accessorKey: "filterType", header: () => <ColumnHeader tKey="filter" ns="fields" /> },
    { accessorKey: "contactNumber", header: () => <ColumnHeader tKey="contactNumber" ns="fields" /> },
    {
      accessorKey: "address",
      header: () => <ColumnHeader tKey="address" ns="fields" />,
      cell: ({ row }) => <AddressCell address={row.original.address} />,
    },
    {
      accessorKey: "planDate",
      header: () => <ColumnHeader tKey="planD" ns="fields" />,
      cell: ({ row }) => formatDate(row.original.planDate),
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
      accessorKey: "productNo",
      header: () => <ColumnHeader tKey="productNo" ns="fields" />,
      cell: ({ row }) => <TruncatedCell value={row.original.productNo} />,
    },
    {
      accessorKey: "serviceman",
      header: () => <ColumnHeader tKey="serviceman" ns="fields" />,
      cell: ({ row }) => (row.original.serviceman ? formatTechnicians(row.original.serviceman, row.original.serviceman2, "&") : "—"),
    },
    {
      accessorKey: "source",
      header: () => <ColumnHeader tKey="source" ns="fields" />,
      cell: ({ row }) => <SourceCell source={row.original.source} />,
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

  if (canDelete) {
    columns.push({
      id: "delete",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-danger hover:text-danger"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(row.original)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    })
  }

  return columns
}

export const FILTER_CHANGE_EXPORT_COLUMNS = [
  { header: "Order Number", key: "orderNumber" },
  { header: "Member Account#", key: "memberAccount" },
  { header: "Filter", key: "filterType" },
  { header: "Contact #", key: "contactNumber" },
  { header: "Address", key: "address" },
  { header: "S/C", key: "sc" },
  { header: "Plan D", key: "planDate" },
  { header: "Pre D", key: "preD" },
  { header: "Acc D", key: "accD" },
  { header: "Product #", key: "productNo" },
  { header: "Serviceman", key: "serviceman" },
  { header: "Serviceman 2", key: "serviceman2" },
  { header: "Source", key: "source" },
  { header: "Note", key: "note" },
  { header: "Status", key: "status" },
]
