import { supabase } from "@/lib/supabase/client"
import type { PaymentMethod, PaymentStatus } from "@/lib/types"

export interface PortalCustomer {
  id: string
  orderNumber: string
  fullName: string
  companyName: string | null
  contractNumber: string
  contractStart: string
  contractEnd: string
  address: string
  email: string
  contactNumber: string
  dispenserType: string
  filterInstalled: boolean
  installedDate: string | null
  assignedTechnician: string
}

export interface PortalSale {
  id: string
  invoiceNumber: string
  date: string
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  totalAmount: number
  items: { productId: string; quantity: number }[]
}

export interface PortalProduct {
  id: string
  name: string
}

export interface PortalSettings {
  companyName: string
  address: string
  contactNumbers: { label: string; value: string }[]
  contactEmails: { label: string; value: string }[]
  monitoringDefaultMonths: number
  monitoringIntervals: Record<string, number>
}

export interface PortalProfile {
  customer: PortalCustomer
  sales: PortalSale[]
  products: PortalProduct[]
  settings: PortalSettings | null
}

type RpcRow = {
  customer: {
    id: string
    order_number: string
    full_name: string
    company_name: string | null
    contract_number: string
    contract_start: string
    contract_end: string
    address: string
    email: string
    contact_number: string
    dispenser_type: string
    filter_installed: boolean
    installed_date: string | null
    assigned_technician: string
  } | null
  sales: {
    id: string
    invoice_number: string
    date: string
    payment_method: string
    payment_status: string
    total_amount: number
    items: { productId: string; quantity: number }[]
  }[]
  products: PortalProduct[]
  settings: {
    company_name: string
    address: string
    contact_numbers: { label: string; value: string }[]
    contact_emails: { label: string; value: string }[]
    monitoring_default_months?: number | null
    monitoring_intervals?: Record<string, number> | null
  } | null
}

// Reached anonymously by scanning a customer's QR code — no session exists, so this
// goes through a security-definer RPC scoped to exactly one customer's own data
// rather than relying on table RLS (see the migration for why).
export async function getPortalProfile(customerId: string): Promise<PortalProfile | null> {
  const { data, error } = await supabase.rpc("get_portal_profile", { p_customer_id: customerId })
  if (error) throw error
  const row = data as RpcRow
  // React Query treats a query function resolving to `undefined` as an error, not
  // a valid "no data" result — null is the correct way to represent "not found".
  if (!row?.customer) return null
  return {
    customer: {
      id: row.customer.id,
      orderNumber: row.customer.order_number,
      fullName: row.customer.full_name,
      companyName: row.customer.company_name,
      contractNumber: row.customer.contract_number,
      contractStart: row.customer.contract_start,
      contractEnd: row.customer.contract_end,
      address: row.customer.address,
      email: row.customer.email,
      contactNumber: row.customer.contact_number,
      dispenserType: row.customer.dispenser_type,
      filterInstalled: row.customer.filter_installed,
      installedDate: row.customer.installed_date,
      assignedTechnician: row.customer.assigned_technician,
    },
    sales: row.sales.map((s) => ({
      id: s.id,
      invoiceNumber: s.invoice_number,
      date: s.date,
      paymentMethod: s.payment_method as PaymentMethod,
      paymentStatus: s.payment_status as PaymentStatus,
      totalAmount: Number(s.total_amount),
      items: s.items,
    })),
    products: row.products,
    settings: row.settings
      ? {
          companyName: row.settings.company_name,
          address: row.settings.address,
          contactNumbers: row.settings.contact_numbers,
          contactEmails: row.settings.contact_emails,
          monitoringDefaultMonths: row.settings.monitoring_default_months ?? 6,
          monitoringIntervals: row.settings.monitoring_intervals ?? {},
        }
      : null,
  }
}
