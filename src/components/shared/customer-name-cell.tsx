"use client"

import { useRouter } from "next/navigation"
import { TruncatedCell } from "@/components/shared/truncated-cell"

// Clicking a customer's name in the standalone Filter Change/Collection
// Plan/Repair Plan list pages jumps to their own profile. stopPropagation
// keeps this from also firing the row's own onRowClick (which opens that
// record's own detail panel/drill-down instead) — same "inner interactive
// element wins" convention every other in-row action (delete, edit-date,
// status select, inline edit cells) already uses in these tables. Falls
// back to plain, non-clickable text when no customerId could be resolved
// for this row (an older record with no customer link, or no match found).
export function CustomerNameCell({ name, customerId }: { name: string; customerId?: string }) {
  const router = useRouter()
  if (!customerId) return <TruncatedCell value={name} />
  return (
    <TruncatedCell
      value={name}
      onClick={(e) => {
        e.stopPropagation()
        router.push(`/customers/${customerId}`)
      }}
    />
  )
}
