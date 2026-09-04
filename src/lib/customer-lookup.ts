import type { Customer, SaleListEntry } from "@/lib/types"

// The canonical way to resolve a typed Order Number to an existing customer
// record. Verified directly against live data before writing this: the two
// numbering schemes never overlap. `customers.order_number` is each
// customer's own original contract number (all "SK001-####"); the order
// number actually typed into Filter Change/Install/Repair/Collection day to
// day — and stored in sale_list_entries.order_number — is a different,
// plain "001-####" scheme with zero overlap against customers.order_number
// in practice. The real link is sale_list_entries.customer_id, so that's
// checked first; a direct customers.order_number match is only the
// fallback, for the (currently unseen, but not impossible) case of someone
// typing a customer's own original contract number instead. Both sides are
// trimmed before comparing — real order numbers in this app have picked up
// stray leading/trailing whitespace from the original AppSheet import.
//
// This is the single shared match every Add form's order-number autofill
// uses, and what DispatchApprovalQueue's own order-number fallback
// (findCustomer) delegates to as well, so the two can never drift into two
// different ideas of "the same order."
export function findCustomerByOrderNumber(
  customers: Customer[],
  saleListEntries: SaleListEntry[],
  orderNumber: string
): Customer | undefined {
  const trimmed = orderNumber.trim()
  if (!trimmed) return undefined

  const viaSale = saleListEntries.find((e) => e.orderNumber.trim() === trimmed)
  if (viaSale?.customerId) {
    const customer = customers.find((c) => c.id === viaSale.customerId)
    if (customer) return customer
  }

  return customers.find((c) => c.orderNumber.trim() === trimmed)
}
