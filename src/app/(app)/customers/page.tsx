"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MapPin, Plus, Printer, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { MonthYearFilter, type MonthYearValue } from "@/components/data-table/month-year-filter"
import { ExportButtons } from "@/components/shared/export-buttons"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { DetailField, DetailPanel, useSplitViewSelection } from "@/components/data-table/split-view"
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog"
import { MemberMapPanel } from "@/components/customers/member-map-panel"
import { MemberDirectionsDialog } from "@/components/customers/member-directions-dialog"
import { MemberRelatedSalesTable } from "@/components/customers/member-related-sales"
import { MemberOrderDetail } from "@/components/customers/member-order-detail"
import { BreadcrumbTrail } from "@/components/shared/breadcrumb-trail"
import { getCustomerColumns, type CustomerRow } from "@/components/customers/customers-columns"
import type { SaleListRow } from "@/components/sale-list/sale-list-columns"
import { useCustomers, useDeleteCustomer } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useSettings } from "@/lib/hooks/use-misc"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { printFieldsAndTable } from "@/lib/export/print"
import { formatDate, getContractStatus } from "@/lib/utils"
import type { ContractStatus, Customer } from "@/lib/types"
import { parseISO } from "date-fns"

export default function CustomersPage() {
  const router = useRouter()
  const { can } = useAuth()
  const { t } = useTranslation("member")
  const { t: tNav } = useTranslation("nav")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const { data: customers = [], isPending } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { data: settings } = useSettings()
  const deleteCustomer = useDeleteCustomer()

  const [statusFilter, setStatusFilter] = React.useState<"all" | ContractStatus>("all")
  const [monthYear, setMonthYear] = React.useState<MonthYearValue>({ month: "all", year: "all" })
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Customer | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<Customer | undefined>(undefined)
  // Independent of `selection` — a pin click on the Map panel (only rendered
  // in the un-selected list+map view) needs to open directions for a member
  // that was never drilled into via the split-view panel.
  const [directionsTarget, setDirectionsTarget] = React.useState<Customer | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<CustomerRow[]>([])
  const [searchQuery, setSearchQuery] = React.useState("")

  const realCustomers = React.useMemo(() => customers.filter((c) => !c.isSystem), [customers])

  // Same customer<->order matching relatedSaleRows below already uses
  // (customerId when the sale list entry has one, else falling back to a
  // literal orderNumber match) — computed for every customer up front here
  // so the Member List's own search (see CustomerRow.relatedOrderNumbers)
  // can find a member by any of their orders' own "001-####" numbers, not
  // just their customers.order_number ("SK001-####"). Reported as broken
  // for customers.order_number, but that one was already searchable (it's
  // a plain field on the row DataTable's generic search already scans) —
  // this was the actual gap, confirmed against real data before assuming
  // which field needed fixing.
  const relatedOrderNumbersByCustomerId = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const customer of realCustomers) {
      const orders = saleListEntries
        .filter((e) => (e.customerId ? e.customerId === customer.id : e.orderNumber === customer.orderNumber))
        .map((e) => e.orderNumber.trim())
      if (orders.length > 0) map.set(customer.id, orders)
    }
    return map
  }, [realCustomers, saleListEntries])

  const rows: CustomerRow[] = React.useMemo(
    () =>
      realCustomers.map((c) => ({
        ...c,
        contractStatus: getContractStatus(c.contractEnd),
        relatedOrderNumbers: (relatedOrderNumbersByCustomerId.get(c.id) ?? []).join(" "),
      })),
    [realCustomers, relatedOrderNumbersByCustomerId]
  )

  const years = React.useMemo(
    () => Array.from(new Set(realCustomers.map((c) => parseISO(c.createdAt).getFullYear()))).sort((a, b) => b - a),
    [realCustomers]
  )

  const scopedRows = React.useMemo(() => {
    return rows.filter((c) => {
      if (statusFilter !== "all" && c.contractStatus !== statusFilter) return false
      const created = parseISO(c.createdAt)
      if (monthYear.month !== "all" && created.getMonth() !== Number(monthYear.month)) return false
      if (monthYear.year !== "all" && created.getFullYear() !== Number(monthYear.year)) return false
      return true
    })
  }, [rows, statusFilter, monthYear])

  const selection = useSplitViewSelection(filteredRows.length ? filteredRows : scopedRows)

  // Only set while the search box actually has text — filteredRows alone
  // can't tell "no search" apart from "search matched every row", and the
  // Map panel needs to fall back to its normal default view (not just stay
  // wherever the last search left it) once the box is cleared.
  const topSearchMatch = React.useMemo(
    () => (searchQuery.trim() ? (filteredRows[0] ?? null) : null),
    [searchQuery, filteredRows]
  )

  // The selected member's own sale list entries — scoped fresh whenever the
  // selected member changes, so drilling into an order for one member never
  // leaks into another's Previous/Next stepping.
  const relatedSaleRows: SaleListRow[] = React.useMemo(() => {
    const member = selection.selected
    if (!member) return []
    const accountLabel = member.companyName || member.fullName
    return saleListEntries
      .filter((e) => (e.customerId ? e.customerId === member.id : e.orderNumber === member.orderNumber))
      .map((e) => ({ ...e, accountLabel }))
  }, [saleListEntries, selection.selected])

  const orderSelection = useSplitViewSelection(relatedSaleRows)

  const columns = React.useMemo(
    () =>
      getCustomerColumns({
        canDelete: can("customers:delete"),
        onEdit: (c) => {
          setEditing(c)
          setFormOpen(true)
        },
        onDelete: (c) => setDeleting(c),
      }),
    [can]
  )

  const exportColumns = [
    { header: "Member Account#", key: "memberAccountNumber" },
    { header: "Account Name", key: "companyName" },
    { header: "Contact Person", key: "fullName" },
    { header: "Contact Number 1 (Main)", key: "contactNumber" },
    { header: "Contact Number 2 (Sub)", key: "contactNumber2" },
    { header: "Address", key: "address" },
    { header: "Email Address 1 (Main)", key: "email" },
    { header: "TIN #", key: "tin" },
    { header: "Order Number", key: "orderNumber" },
    { header: "Contract Number", key: "contractNumber" },
    { header: "Status", key: "contractStatus" },
    { header: "Contract Start", key: "contractStart" },
    { header: "Contract End", key: "contractEnd" },
    { header: "Water Purification Type", key: "dispenserType" },
    { header: "Technician", key: "assignedTechnician" },
  ]

  // Mirrors exactly what's shown in the Member detail panel below (the six
  // read-only fields plus Related Sales_Lists) — not the fuller exportColumns
  // set above, which includes fields the panel itself doesn't display.
  function handlePrint() {
    const member = selection.selected
    if (!member) return
    printFieldsAndTable({
      title: member.companyName || member.fullName,
      subtitle: `Member Account# ${member.memberAccountNumber}`,
      fields: [
        { label: "Member Account#", value: member.memberAccountNumber },
        { label: "Account Name", value: member.companyName || "" },
        { label: "Account Contact Person", value: member.fullName },
        { label: "Contact Number 1 (Main)", value: member.contactNumber },
        { label: "Contact Number 2 (Sub)", value: member.contactNumber2 || "" },
        { label: "Address", value: member.address },
      ],
      tableTitle: "Related Sales_Lists",
      columns: [
        { header: "Order Number", key: "orderNumber" },
        { header: "Installed Date", key: "installedDate" },
        { header: "Account#", key: "accountLabel" },
        { header: "Product#", key: "productNo" },
        { header: "S/C", key: "sc" },
      ],
      rows: relatedSaleRows.map((r) => ({
        ...r,
        installedDate: r.installedDate ? formatDate(r.installedDate) : "",
      })),
    })
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  // AppSheet-style drill-down: each click replaces the current view and goes
  // one level deeper (list -> member -> order) instead of showing the list
  // and detail side by side. The level you came from minimizes into a
  // breadcrumb crumb rather than staying visible.
  return (
    // h-full (not overflow-hidden) here — the Detail/Order-detail branches
    // below can carry natural, potentially-tall content that genuinely
    // needs to overflow and let <main> scroll it normally, same as always;
    // the list-view branch further down hard-bounds itself the same way
    // for as long as its content actually fits (see its own comment on the
    // Card's min-h-120 floor for the one deliberate exception). h-full,
    // not a viewport calc like h-[calc(100vh-4rem)] — <main> (see
    // layout.tsx) already applies its own padding around this page's
    // content, which a fixed viewport subtraction doesn't know about and
    // would silently overshoot by, exactly the mismatch that let <main>'s
    // own overflow-y-auto still engage alongside the table's internal
    // scrollbar. h-full always resolves to <main>'s real, padding-correct
    // available height instead — this page never adds its own competing
    // overflow-y-auto/min-h-screen on top of that single scroll region.
    <div className="flex h-full flex-col gap-6">
      {!selection.selected ? (
        // Everything above the table (heading row, map) is shrink-0 —
        // fixed to its own natural or assigned height — so the table's
        // flex-1 share is exactly "whatever's left," not an estimate. See
        // data-table.tsx's own comment on why a sticky header needs a real
        // bounded scroll ancestor to actually work.
        //
        // No overflow-hidden here (unlike a plain hard-bound branch) —
        // the table Card below carries a min-h-120 (480px) floor (~10 rows)
        // so it's never squeezed thinner than that, and on a viewport short
        // enough that heading + map + that floor genuinely don't all fit,
        // this wrapper needs to let the excess overflow upward to <main>
        // (which already scrolls) rather than silently clipping rows off
        // the bottom with no way to reach them.
        <div className="flex flex-1 min-h-0 flex-col gap-6">
          <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <Users className="h-6 w-6 text-primary" /> {tNav("member")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("pageDescription")}
              </p>
            </div>
            {can("customers:add") && (
              <Button
                onClick={() => {
                  setEditing(undefined)
                  setFormOpen(true)
                }}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" /> {t("addMember")}
              </Button>
            )}
          </div>

          {/* Full-width banner above the table, rather than the old
              side-by-side split — a fixed height (see member-map-panel.tsx,
              now h-full so this wrapper is the one true source of its
              height) keeps it a clean map overview instead of dominating
              the page the way a 600px-tall map matched to the table's own
              height used to. */}
          <div className="h-95 w-full shrink-0">
            <MemberMapPanel
              customers={scopedRows}
              focusCustomer={topSearchMatch}
              onOpenDirections={setDirectionsTarget}
            />
          </div>

          {/* min-h-120 (480px) instead of a plain min-h-0 floor —
              guarantees the table area never gets squeezed below roughly
              10 visible rows (~480px covers DataTable's own search bar +
              header + row chrome, see data-table.tsx's TABLE_ROW_HEIGHT)
              no matter how tall the map above grows or how short the
              viewport is. Still flex-1 above that floor, so on any screen
              with room to spare the table keeps claiming "whatever's left"
              exactly as before — this only ever changes behavior in the
              genuine squeeze case, where the wrapper above deliberately has
              no overflow-hidden to clip it, so the excess is left for
              <main> to scroll instead of silently hiding rows with no way
              to reach them. */}
          <Card className="flex-1 min-h-120">
            <CardContent className="flex flex-1 min-h-0 flex-col pt-6">
              {/* table-fixed + each column's own fixed width (see
                  customers-columns.tsx's meta) means the table's total
                  width is always the sum of its columns' assigned widths —
                  1360px, now wider than most viewports since these were
                  deliberately expanded for readability (Account Name,
                  Address, etc.) at TIN #'s expense. min-w-[1360px] on the
                  table itself (not just w-full) is what makes table-fixed
                  actually honor each column's real pixel width instead of
                  compressing them all to fit 100% of the container — and
                  overflow-x-auto below is what turns that overflow into an
                  inner scrollbar on this card instead of pushing the whole
                  page wider (matches member-order-detail.tsx's own
                  min-w-[1000px] w-full + overflow-x-auto pattern). flex-1
                  min-h-0 overflow-hidden is what hands DataTable's own
                  h-full scroll box its exact bounded height instead of
                  letting it grow to content. */}
              <div className="flex-1 min-h-0 overflow-hidden">
                  <DataTable
                    columns={columns}
                    data={scopedRows}
                    searchPlaceholder={t("searchPlaceholder")}
                    onFilteredRowsChange={setFilteredRows}
                    onSearchChange={setSearchQuery}
                    emptyMessage={t("noMembersFound")}
                    onRowClick={(row) => selection.open(row)}
                    tableClassName="table-fixed min-w-[1360px] w-full"
                    tableContainerClassName="overflow-x-auto"
                    scrollContainerClassName="overflow-x-auto"
                    headerCellClassName="px-2 py-1.5"
                    bodyCellClassName="px-2 py-1.5"
                    toolbar={
                      <>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                          <SelectTrigger className="h-9 w-[150px]">
                            <SelectValue placeholder={t("contractStatus")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{tCommon("allStatuses")}</SelectItem>
                            <SelectItem value="active">{tStatus("active")}</SelectItem>
                            <SelectItem value="expiring">{tStatus("expiringSoon")}</SelectItem>
                            <SelectItem value="expired">{tStatus("expired")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <MonthYearFilter value={monthYear} onChange={setMonthYear} years={years} />
                        <ExportButtons
                          title="Member List"
                          subtitle={`Generated ${formatDate(new Date().toISOString())}`}
                          fileName="members"
                          columns={exportColumns}
                          rows={filteredRows}
                        />
                      </>
                    }
                  />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : orderSelection.selected ? (
        <MemberOrderDetail
          customer={selection.selected}
          entry={orderSelection.selected}
          rows={relatedSaleRows}
          onSelectOrder={orderSelection.open}
          can={can}
          onPrev={orderSelection.prev}
          onNext={orderSelection.next}
          hasPrev={orderSelection.hasPrev}
          hasNext={orderSelection.hasNext}
          onClose={orderSelection.close}
          onNavigateToList={selection.close}
        />
      ) : (
        <>
          <BreadcrumbTrail
            items={[
              { label: tNav("member"), onClick: selection.close },
              { label: selection.selected.companyName || selection.selected.fullName },
            ]}
          />
          <DetailPanel
            title={selection.selected.companyName || selection.selected.fullName}
            icon={Users}
            subtitle={selection.selected.memberAccountNumber}
            onEdit={
              can("customers:edit")
                ? () => {
                    setEditing(selection.selected ?? undefined)
                    setFormOpen(true)
                  }
                : undefined
            }
            onDelete={can("customers:delete") ? () => setDeleting(selection.selected ?? undefined) : undefined}
            headerActions={
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
                <Printer className="h-3.5 w-3.5" /> {tCommon("print")}
              </Button>
            }
            onPrev={selection.prev}
            onNext={selection.next}
            hasPrev={selection.hasPrev}
            hasNext={selection.hasNext}
            expanded={selection.expanded}
            // Expand goes to the full profile page (QR code, service history,
            // related sales) instead of a generic fullscreen field dump.
            onToggleExpand={() => router.push(`/customers/${selection.selected!.id}`)}
            onClose={selection.close}
            extra={
              <MemberRelatedSalesTable
                customer={selection.selected}
                rows={relatedSaleRows}
                can={can}
                onSelectOrder={orderSelection.open}
              />
            }
          >
            {/* Matches the AppSheet Member detail view exactly — just these
                six fields, single column. The rest (email, TIN, contract
                dates, etc.) are unchanged and still editable via Edit; they
                just aren't shown in this read-only view. */}
            <DetailField
              label={tFields("memberAccount")}
              value={selection.selected.memberAccountNumber}
              className="sm:col-span-2"
            />
            <DetailField label={tFields("accountName")} value={selection.selected.companyName} className="sm:col-span-2" />
            <DetailField
              label={t("accountContactPerson")}
              value={selection.selected.fullName}
              className="sm:col-span-2"
            />
            <DetailField
              label={t("contactNumber1MainHeader")}
              value={selection.selected.contactNumber}
              className="sm:col-span-2"
            />
            <DetailField
              label={t("contactNumber2SubHeader")}
              value={selection.selected.contactNumber2}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm text-muted-foreground">{tFields("address")}</p>
              {selection.selected.address ? (
                <button
                  type="button"
                  onClick={() => setDirectionsTarget(selection.selected ?? undefined)}
                  title={t("getDirectionsTitle")}
                  className="inline-flex items-start gap-1.5 text-left text-base font-medium wrap-break-word text-primary hover:underline"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {selection.selected.address}
                </button>
              ) : (
                <div className="text-base font-medium">—</div>
              )}
            </div>
          </DetailPanel>
        </>
      )}

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editing} />

      <MemberDirectionsDialog
        open={!!directionsTarget}
        onOpenChange={(o) => !o && setDirectionsTarget(undefined)}
        originAddress={settings?.address ?? ""}
        destinationAddress={directionsTarget?.address ?? ""}
        destinationLabel={directionsTarget?.companyName || directionsTarget?.fullName || ""}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deleteMemberTitle")}
        description={t("deleteMemberDescription", { name: deleting?.companyName || deleting?.fullName || t("thisMember") })}
        loading={deleteCustomer.isPending}
        onConfirm={async () => {
          if (!deleting) return
          // The mutation's onError already toasts the reason — catch here so that
          // rejection doesn't also surface as an unhandled-error dev overlay.
          try {
            const wasSelected = selection.selected?.id === deleting.id
            await deleteCustomer.mutateAsync(deleting.id)
            setDeleting(undefined)
            if (wasSelected) selection.close()
          } catch {
            // handled by the mutation's onError toast
          }
        }}
      />
    </div>
  )
}
