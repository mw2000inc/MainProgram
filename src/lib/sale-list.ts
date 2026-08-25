import type { SaleListRow } from "@/components/sale-list/sale-list-columns"

const PRIMARY_ROW_PREFIX = "primary:"

export function primaryOrderRowId(customerId: string): string {
  return `${PRIMARY_ROW_PREFIX}${customerId}`
}

// True for the synthetic row ensurePrimaryOrderRow() adds — not a real
// sale_list_entries row, so callers that let an admin drill into a row
// (edit/delete/expand-to-its-own-page) must disable those actions rather
// than hitting a 0-row update or a broken /sale-list/[id] link.
export function isPrimaryOrderRow(id: string): boolean {
  return id.startsWith(PRIMARY_ROW_PREFIX)
}

// Ensures a member's own order_number always appears in their Related Sales
// list, even when no sale_list_entries row shares that exact order number —
// synthesizing a minimal, view-only row for it instead. If a real row
// already has that order number, nothing is added (no duplicate).
export function ensurePrimaryOrderRow(
  rows: SaleListRow[],
  customer: {
    id: string
    orderNumber: string
    companyName?: string | null
    fullName: string
    // Per-customer opt-out (see 20260826010000_customer_hide_primary_order.sql)
    // for the rare case where a customer's own order_number genuinely
    // shouldn't appear as a row here — a business decision, not something
    // derivable from other customers' data.
    hidePrimaryOrder?: boolean
  }
): SaleListRow[] {
  if (customer.hidePrimaryOrder) return rows
  if (!customer.orderNumber || rows.some((r) => r.orderNumber === customer.orderNumber)) return rows
  const primaryRow: SaleListRow = {
    id: primaryOrderRowId(customer.id),
    orderNumber: customer.orderNumber,
    accountLabel: customer.companyName || customer.fullName,
    productNo: "",
    sc: "",
    cf: "",
    ct: "",
    cpY1Y2: "",
    status: "ACTIVE",
    createdAt: "",
  }
  return [primaryRow, ...rows]
}
