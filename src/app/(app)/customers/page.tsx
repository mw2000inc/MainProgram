"use client"

import * as React from "react"
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
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog"
import { getCustomerColumns, type CustomerRow } from "@/components/customers/customers-columns"
import { useCustomers, useDeleteCustomer } from "@/lib/hooks/use-customers"
import { useAuth } from "@/lib/auth/auth-context"
import { formatDate, getContractStatus } from "@/lib/utils"
import type { ContractStatus, Customer } from "@/lib/types"
import { parseISO } from "date-fns"

export default function CustomersPage() {
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

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={scopedRows}
            searchPlaceholder="Search by name, account number, email..."
            onFilteredRowsChange={setFilteredRows}
            emptyMessage="No members found."
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
            await deleteCustomer.mutateAsync(deleting.id)
            setDeleting(undefined)
          } catch {
            // handled by the mutation's onError toast
          }
        }}
      />
    </div>
  )
}
