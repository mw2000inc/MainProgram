import type { Customer } from "@/lib/types"

// The canonical way to resolve a typed Order Number to an existing customer
// record. The `customers` table is one row per order (see
// dispatch-approval-queue.tsx's own comment on this), so a Filter Change/
// Install/Repair/Collection order number typed into any of those modules'
// Add forms is, in the common case, really referring to a row already here —
// this is the single shared match every one of those forms' order-number
// autofill uses, and what DispatchApprovalQueue's own order-number fallback
// (findCustomer) delegates to as well, so the two can never drift into two
// different ideas of "the same order." Both sides are trimmed before
// comparing — real customers.order_number values in this app have picked up
// stray leading/trailing whitespace from the original AppSheet import, and
// an exact-but-whitespace-sensitive match would silently defeat the autofill
// for exactly the records it would help most.
export function findCustomerByOrderNumber(customers: Customer[], orderNumber: string): Customer | undefined {
  const trimmed = orderNumber.trim()
  if (!trimmed) return undefined
  return customers.find((c) => c.orderNumber.trim() === trimmed)
}
