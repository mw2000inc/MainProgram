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
