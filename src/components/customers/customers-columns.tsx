"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ColumnHeader } from "@/components/shared/column-header"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { Customer, ContractStatus } from "@/lib/types"

export type CustomerRow = Customer & { contractStatus: ContractStatus }

function RowActionsCell({
  customer,
  canDelete,
  onEdit,
  onDelete,
}: {
  customer: CustomerRow
  canDelete: boolean
  onEdit: (customer: CustomerRow) => void
  onDelete: (customer: CustomerRow) => void
}) {
  const { t } = useTranslation("common")
  const { t: tMember } = useTranslation("member")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/customers/${customer.id}`}>
            <Eye className="h-4 w-4" /> {tMember("viewProfile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(customer)}>
          <Pencil className="h-4 w-4" /> {t("edit")}
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(customer)}>
            <Trash2 className="h-4 w-4" /> {t("delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Matches the old AppSheet "Member List" screen's column layout exactly.
export function getCustomerColumns({
  canDelete,
  onEdit,
  onDelete,
}: {
  canDelete: boolean
  onEdit: (customer: CustomerRow) => void
  onDelete: (customer: CustomerRow) => void
}): ColumnDef<CustomerRow, unknown>[] {
  return [
    {
      accessorKey: "memberAccountNumber",
      header: () => <ColumnHeader tKey="memberAccount" ns="fields" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.memberAccountNumber || "—"}</span>
      ),
    },
    {
      // Account Name — falls back to Contact Person when there's no separate company.
      // Plain text, not a Link: the row itself is now clickable (opens the
      // split-view detail panel) — "View Profile" in the row menu below is
      // the direct link to the full page.
      id: "accountName",
      header: () => <ColumnHeader tKey="accountName" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.companyName || row.original.fullName}</span>,
    },
    {
      accessorKey: "fullName",
      header: () => <ColumnHeader tKey="contactPerson" ns="member" />,
      cell: ({ row }) => row.original.fullName || "—",
    },
    {
      accessorKey: "contactNumber",
      header: () => <ColumnHeader tKey="contactNumber1MainHeader" ns="member" />,
    },
    {
      accessorKey: "contactNumber2",
      header: () => <ColumnHeader tKey="contactNumber2SubHeader" ns="member" />,
      cell: ({ row }) => row.original.contactNumber2 || "—",
    },
    {
      accessorKey: "address",
      header: () => <ColumnHeader tKey="address" ns="fields" />,
    },
    {
      accessorKey: "email",
      header: () => <ColumnHeader tKey="emailAddress1Main" ns="member" />,
    },
    {
      accessorKey: "tin",
      header: () => <ColumnHeader tKey="tin" ns="member" />,
      cell: ({ row }) => row.original.tin || "—",
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <RowActionsCell customer={row.original} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} />
      ),
    },
  ]
}
