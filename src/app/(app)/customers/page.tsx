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
import { printFieldsAndTable } from "@/lib/export/print"
import { formatDate, getContractStatus } from "@/lib/utils"
import type { ContractStatus, Customer } from "@/lib/types"
import { parseISO } from "date-fns"

export default function CustomersPage() {
  const router = useRouter()
  const { can } = useAuth()
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

  const realCustomers = React.useMemo(() => customers.filter((c) => !c.isSystem), [customers])

  const rows: CustomerRow[] = React.useMemo(
    () => realCustomers.map((c) => ({ ...c, contractStatus: getContractStatus(c.contractEnd) })),
    [realCustomers]
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
    <div className="space-y-6">
      {!selection.selected ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <Users className="h-6 w-6 text-primary" /> Member
              </h1>
              <p className="text-sm text-muted-foreground">
                Manage member accounts, contracts and installed products.
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
                <Plus className="h-4 w-4" /> Add Member
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card>
              <CardContent className="pt-6">
                <DataTable
                  columns={columns}
                  data={scopedRows}
                  searchPlaceholder="Search by name, account number, email..."
                  onFilteredRowsChange={setFilteredRows}
                  emptyMessage="No members found."
                  onRowClick={(row) => selection.open(row)}
                  toolbar={
                    <>
                      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                        <SelectTrigger className="h-9 w-[150px]">
                          <SelectValue placeholder="Contract Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="expiring">Expiring Soon</SelectItem>
                          <SelectItem value="expired">Expired</SelectItem>
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
              </CardContent>
            </Card>
            <MemberMapPanel customers={scopedRows} onOpenDirections={setDirectionsTarget} />
          </div>
        </>
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
              { label: "Member", onClick: selection.close },
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
                <Printer className="h-3.5 w-3.5" /> Print
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
              label="Member Account#"
              value={selection.selected.memberAccountNumber}
              className="sm:col-span-2"
            />
            <DetailField label="Account Name" value={selection.selected.companyName} className="sm:col-span-2" />
            <DetailField
              label="Account Contact Person"
              value={selection.selected.fullName}
              className="sm:col-span-2"
            />
            <DetailField
              label="Contact Number 1 (Main)"
              value={selection.selected.contactNumber}
              className="sm:col-span-2"
            />
            <DetailField
              label="Contact Number 2 (Sub)"
              value={selection.selected.contactNumber2}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm text-muted-foreground">Address</p>
              {selection.selected.address ? (
                <button
                  type="button"
                  onClick={() => setDirectionsTarget(selection.selected ?? undefined)}
                  title="Get driving directions from the MW2000 office"
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
        title="Delete member?"
        description={`This will permanently remove ${deleting?.companyName || deleting?.fullName || "this member"} and their contract record.`}
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
