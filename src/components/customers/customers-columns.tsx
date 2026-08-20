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
import type { Customer, ContractStatus } from "@/lib/types"

export type CustomerRow = Customer & { contractStatus: ContractStatus }

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
      header: "Member Account#",
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
      header: "Account Name",
      cell: ({ row }) => <span className="font-medium">{row.original.companyName || row.original.fullName}</span>,
    },
    {
      accessorKey: "fullName",
      header: "Contact Person",
      cell: ({ row }) => row.original.fullName || "—",
    },
    {
      accessorKey: "contactNumber",
      header: "Contact Number 1 (Main)",
    },
    {
      accessorKey: "contactNumber2",
      header: "Contact Number 2 (Sub)",
      cell: ({ row }) => row.original.contactNumber2 || "—",
    },
    {
      accessorKey: "address",
      header: "Address",
    },
    {
      accessorKey: "email",
      header: "Email Address 1 (Main)",
    },
    {
      accessorKey: "tin",
      header: "TIN #",
      cell: ({ row }) => row.original.tin || "—",
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/customers/${row.original.id}`}>
                <Eye className="h-4 w-4" /> View Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(row.original)}>
              <Pencil className="h-4 w-4" /> Edit
            </DropdownMenuItem>
            {canDelete && (
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(row.original)}>
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
}
