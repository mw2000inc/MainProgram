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
import { TruncatedCell } from "@/components/shared/truncated-cell"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { Customer, ContractStatus } from "@/lib/types"

export type CustomerRow = Customer & {
  contractStatus: ContractStatus
  // Every sale_list_entries.order_number belonging to this customer (see
  // customers/page.tsx's own matching logic), space-joined — never
  // rendered as a column, it exists purely so DataTable's own generic
  // Object.values() search (see data-table.tsx) can find a member by any
  // one of their specific orders' own "001-####" order numbers, not just
  // customers.order_number itself (the "SK001-####" contract-era number,
  // already searchable since it's a plain field on this same object).
  relatedOrderNumbers: string
}

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
      meta: { headerClassName: "w-27.5 max-w-27.5 truncate", cellClassName: "w-27.5 max-w-27.5 truncate" },
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
      meta: { headerClassName: "w-35 max-w-35 truncate", cellClassName: "w-35 max-w-35" },
      cell: ({ row }) => (
        <TruncatedCell value={row.original.companyName || row.original.fullName} className="font-medium" />
      ),
    },
    {
      accessorKey: "fullName",
      header: () => <ColumnHeader tKey="contactPerson" ns="member" />,
      meta: { headerClassName: "w-30 max-w-30 truncate", cellClassName: "w-30 max-w-30" },
      cell: ({ row }) => <TruncatedCell value={row.original.fullName} />,
    },
    {
      accessorKey: "contactNumber",
      header: () => <ColumnHeader tKey="contactNumber1MainHeader" ns="member" />,
      meta: { headerClassName: "w-27.5 max-w-27.5 truncate", cellClassName: "w-27.5 max-w-27.5 truncate" },
      cell: ({ row }) => row.original.contactNumber || "—",
    },
    {
      accessorKey: "contactNumber2",
      header: () => <ColumnHeader tKey="contactNumber2SubHeader" ns="member" />,
      meta: { headerClassName: "w-27.5 max-w-27.5 truncate", cellClassName: "w-27.5 max-w-27.5 truncate" },
      cell: ({ row }) => row.original.contactNumber2 || "—",
    },
    {
      accessorKey: "address",
      header: () => <ColumnHeader tKey="address" ns="fields" />,
      meta: { headerClassName: "w-40 max-w-40 truncate", cellClassName: "w-40 max-w-40" },
      cell: ({ row }) => <TruncatedCell value={row.original.address} />,
    },
    {
      // No fixed width requested for this one — under table-fixed it just
      // takes its share of whatever's left after the fixed-width columns
      // above, but still needs `truncate` so a long address doesn't
      // visually bleed into the next cell (table-fixed doesn't wrap
      // overflow into a scrollbar the way table-auto would; without
      // overflow:hidden it just renders past the cell's own boundary).
      accessorKey: "email",
      header: () => <ColumnHeader tKey="emailAddress1Main" ns="member" />,
      meta: { headerClassName: "truncate", cellClassName: "truncate" },
      cell: ({ row }) => <TruncatedCell value={row.original.email} />,
    },
    {
      accessorKey: "tin",
      header: () => <ColumnHeader tKey="tin" ns="member" />,
      meta: { headerClassName: "truncate", cellClassName: "truncate" },
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
