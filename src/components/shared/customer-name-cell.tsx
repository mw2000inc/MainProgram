"use client"

import { TruncatedCell } from "@/components/shared/truncated-cell"
import { CustomerNameButton } from "@/components/shared/customer-details"

// Clicking a customer's name in the standalone Filter Change/Collection
// Plan/Repair Plan list pages opens the Customer Details pop-up — not the
// Member page — so the list behind keeps its place. The click stops at the
// name, so the row's own onRowClick (its record's detail panel) doesn't also
// fire — the same "inner interactive element wins" convention every other
// in-row action uses here. Plain text when the row has neither a member link
// nor an Order No. to look one up by.
export function CustomerNameCell({ name, customerId, orderNo }: { name: string; customerId?: string; orderNo?: string }) {
  if (!name || (!customerId && !orderNo)) return <TruncatedCell value={name} />
  return (
    <span className="block max-w-37.5">
      <CustomerNameButton target={{ customerId, orderNo, name }}>{name}</CustomerNameButton>
    </span>
  )
}
