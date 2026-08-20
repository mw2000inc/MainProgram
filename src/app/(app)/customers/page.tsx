"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus, Users } from "lucide-react"
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
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog"
import { getCustomerColumns, type CustomerRow } from "@/components/customers/customers-columns"
import { ContractStatusBadge } from "@/components/shared/status-badge"
import { useCustomers, useDeleteCustomer } from "@/lib/hooks/use-customers"
import { useAuth } from "@/lib/auth/auth-context"
import { formatDate, getContractStatus } from "@/lib/utils"
import type { ContractStatus, Customer } from "@/lib/types"
import { parseISO } from "date-fns"

export default function CustomersPage() {
  const router = useRouter()
  const { user, can } = useAuth()
  const { data: customers = [], isPending } = useCustomers()
  const deleteCustomer = useDeleteCustomer(user?.id ?? "")

  const [statusFilter, setStatusFilter] = React.useState<"all" | ContractStatus>("all")
  const [monthYear, setMonthYear] = React.useState<MonthYearValue>({ month: "all", year: "all" })
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Customer | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<Customer | undefined>(undefined)
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

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Member
          </h1>
          <p className="text-sm text-muted-foreground">Manage member accounts, contracts and installed products.</p>
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

      <SplitViewLayout
        isOpen={selection.isOpen}
        expanded={selection.expanded}
        list={
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
        }
        detail={
          selection.selected && (
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
              onPrev={selection.prev}
              onNext={selection.next}
              hasPrev={selection.hasPrev}
              hasNext={selection.hasNext}
              expanded={selection.expanded}
              // Expand goes to the full profile page (QR code, service history,
              // related sales) instead of a generic fullscreen field dump.
              onToggleExpand={() => router.push(`/customers/${selection.selected!.id}`)}
              onClose={selection.close}
            >
              <DetailField label="Member Account#" value={selection.selected.memberAccountNumber} />
              <DetailField label="Order Number" value={selection.selected.orderNumber} />
              <DetailField label="Account Name" value={selection.selected.companyName} />
              <DetailField label="Contact Person" value={selection.selected.fullName} />
              <DetailField label="Contact Number 1 (Main)" value={selection.selected.contactNumber} />
              <DetailField label="Contact Number 2 (Sub)" value={selection.selected.contactNumber2} />
              <DetailField label="Address" value={selection.selected.address} className="sm:col-span-2" />
              <DetailField label="Email Address 1 (Main)" value={selection.selected.email} />
              <DetailField label="Email Address 2 (Sub)" value={selection.selected.email2} />
              <DetailField label="TIN #" value={selection.selected.tin} />
              <DetailField label="Contract Number" value={selection.selected.contractNumber} />
              <DetailField
                label="Status"
                value={<ContractStatusBadge status={selection.selected.contractStatus} />}
              />
              <DetailField label="Contract Start" value={formatDate(selection.selected.contractStart)} />
              <DetailField label="Contract End" value={formatDate(selection.selected.contractEnd)} />
              <DetailField label="Water Purification Type" value={selection.selected.dispenserType} />
              <DetailField label="Water Filter Installed" value={selection.selected.filterInstalled ? "Yes" : "No"} />
              <DetailField
                label="Installed Date"
                value={selection.selected.installedDate ? formatDate(selection.selected.installedDate) : undefined}
              />
              <DetailField label="Assigned Technician" value={selection.selected.assignedTechnician} />
              <DetailField label="Notes" value={selection.selected.notes} className="sm:col-span-2" />
            </DetailPanel>
          )
        }
      />

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editing} />

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
