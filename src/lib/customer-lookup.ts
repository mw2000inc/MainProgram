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

// Every sale_list_entries.order_number belonging to each customer (matched
// the same way findCustomerByOrderNumber does: customerId when the sale
// entry has one, else a literal customers.order_number fallback) — shared
// by the Member List's own search (see CustomerRow.relatedOrderNumbers) and
// the global command palette, so a customer can be found by any of their
// orders' "001-####" numbers, not just their own "SK001-####" one, in both
// places at once rather than two copies of this logic drifting apart.
export function buildRelatedOrderNumbersByCustomerId(
  customers: Customer[],
  saleListEntries: SaleListEntry[]
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const customer of customers) {
    const orders = saleListEntries
      .filter((e) => (e.customerId ? e.customerId === customer.id : e.orderNumber === customer.orderNumber))
      .map((e) => e.orderNumber.trim())
    if (orders.length > 0) map.set(customer.id, orders)
  }
  return map
}

// The reverse direction of findCustomerByOrderNumber above: given a plan
// record's own customerId (when its table tracks one directly — Filter
// Change/Collection/Schedule/Sale List all do) and/or its own order number,
// resolve back to the customer it belongs to. Trusts an explicit customerId
// link first, falling back to the same order-number bridge for tables that
// don't have one at all (InstallPlan has no customer_id column).
export function resolveCustomerForPlan(
  customers: Customer[],
  saleListEntries: SaleListEntry[],
  customerId: string | undefined,
  orderNumber: string
): Customer | undefined {
  if (customerId) {
    const direct = customers.find((c) => c.id === customerId)
    if (direct) return direct
  }
  return findCustomerByOrderNumber(customers, saleListEntries, orderNumber)
}

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "")
}

// Two phone numbers are "the same" if their last 9 digits match — drops
// varying country/trunk prefixes ("09171234567", "9171234567", "+63 917 123
// 4567" all reduce to the same last-9-digit tail). Shorter than that is too
// weak a signal to match on at all (a handful of shared digits is too easy
// to collide by accident).
const PHONE_MATCH_TAIL_LENGTH = 9

function phoneNumbersMatch(a: string, b: string): boolean {
  const da = normalizePhoneDigits(a)
  const db = normalizePhoneDigits(b)
  if (da.length < PHONE_MATCH_TAIL_LENGTH || db.length < PHONE_MATCH_TAIL_LENGTH) return false
  return da.slice(-PHONE_MATCH_TAIL_LENGTH) === db.slice(-PHONE_MATCH_TAIL_LENGTH)
}

export type MemberMatchField = "memberAccountNumber" | "contactNumber" | "name"

export interface MemberMatch {
  customer: Customer
  matchedOn: MemberMatchField
}

// Used by the Add Member form to detect "this looks like it's already an
// existing member" while an admin is filling out the form, so it can offer
// to load their real record instead of risking a duplicate. Checked in
// decreasing order of confidence: an exact Member Account# match (the
// strongest possible signal — two customers should never legitimately share
// one, see the customers_member_account_number_unique_idx migration), then
// a phone number match (tolerant of formatting differences, see
// phoneNumbersMatch above), then an exact full/company name match (the
// weakest signal, so it only ever fires on a real exact match — never a
// partial one, which would trigger on just the first few letters typed).
export function findExistingMemberMatch(
  customers: Customer[],
  values: { memberAccountNumber?: string; contactNumber?: string; fullName?: string; companyName?: string },
  excludeId?: string
): MemberMatch | undefined {
  const candidates = customers.filter((c) => !c.isSystem && c.id !== excludeId)

  const accountNumber = (values.memberAccountNumber ?? "").trim().toLowerCase()
  if (accountNumber) {
    const byAccount = candidates.find((c) => c.memberAccountNumber.trim().toLowerCase() === accountNumber)
    if (byAccount) return { customer: byAccount, matchedOn: "memberAccountNumber" }
  }

  const phone = values.contactNumber ?? ""
  if (phone.trim()) {
    const byPhone = candidates.find(
      (c) => phoneNumbersMatch(c.contactNumber, phone) || phoneNumbersMatch(c.contactNumber2 ?? "", phone)
    )
    if (byPhone) return { customer: byPhone, matchedOn: "contactNumber" }
  }

  const name = (values.companyName ?? values.fullName ?? "").trim().toLowerCase()
  if (name) {
    const byName = candidates.find(
      (c) =>
        (c.companyName && c.companyName.trim().toLowerCase() === name) ||
        (c.fullName && c.fullName.trim().toLowerCase() === name)
    )
    if (byName) return { customer: byName, matchedOn: "name" }
  }

  return undefined
}

// The one order a customer-level summary (the customer portal's "Personal
// Information") should describe when a customer can have several. A member's
// own customers.order_number ("SK001-####") is NOT an order — it's an
// auto-generated member/contract number (a database trigger hands out the next
// value in a sequence on insert), and customers.installed_date is a member-level
// field that is almost never filled in — so neither can stand in for the real
// order; the real ones are the customer's sale_list_entries.
//
// "Current" = the most recently installed order, ignoring discontinued
// (INACTIVE) ones unless that's all there is; ties (same install date, e.g. two
// units installed the same day) go to the most recently entered, then to the
// higher order number so the pick is deterministic. Undefined when the customer
// has no orders at all — callers show "N/A" then, never a made-up number.
export function pickCurrentOrder<T extends Pick<SaleListEntry, "orderNumber" | "installedDate" | "status" | "createdAt">>(
  entries: T[]
): T | undefined {
  if (entries.length === 0) return undefined
  const live = entries.filter((e) => e.status !== "INACTIVE")
  const pool = live.length > 0 ? live : entries
  return [...pool].sort((a, b) => {
    const byInstalled = (b.installedDate ?? "").localeCompare(a.installedDate ?? "")
    if (byInstalled !== 0) return byInstalled
    const byCreated = (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
    if (byCreated !== 0) return byCreated
    return b.orderNumber.trim().localeCompare(a.orderNumber.trim())
  })[0]
}
