import { supabase } from "@/lib/supabase/client"
import type { PaymentMethod, PaymentStatus, FilterChangePlan, CollectionPlan, RepairPlan } from "@/lib/types"

export interface PortalCustomer {
  id: string
  orderNumber: string
  memberAccountNumber: string
  fullName: string
  companyName: string | null
  contractNumber: string
  contractStart: string
  contractEnd: string
  address: string
  contactNumber2: string
  email: string
  contactNumber: string
  dispenserType: string
  filterInstalled: boolean
  installedDate: string | null
  assignedTechnician: string
}

// Reuse the same shapes the admin panels' column definitions are typed
// against (getFilterChangeColumns() etc.), so this read-only page can render
// with those exact same columns instead of a parallel column set.
export type PortalFilterChange = FilterChangePlan
export type PortalCollection = CollectionPlan
export type PortalRepair = RepairPlan

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
  filterChanges: PortalFilterChange[]
  collections: PortalCollection[]
  repairs: PortalRepair[]
  settings: PortalSettings | null
}

type RpcRow = {
  customer: {
    id: string
    order_number: string
    member_account_number: string
    full_name: string
    company_name: string | null
    contract_number: string
    contract_start: string
    contract_end: string
    address: string
    contact_number2: string
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
  filterChanges: {
    id: string
    order_number: string
    member_account: string
    filter_type: string
    plan_date: string
    status: string
    contact_number: string
    address: string
    s_c: string
    product_no: string
    pre_d: string | null
    acc_d: string | null
    serviceman: string
    note: string | null
    created_at: string
  }[]
  collections: {
    id: string
    order_no: string
    account_name: string
    collection_date: string
    amount: number
    status: string
    c_t: string
    pre_d: string | null
    acc_d: string | null
    note: string | null
    created_at: string
  }[]
  repairs: {
    id: string
    issued_date: string
    account_name: string
    order_no: string
    status: string
    problem: string
    solution_status: string | null
    pre_d: string | null
    acc_d: string | null
    th: string
    part_no: string | null
    amt: number
    unit_in_out: string
    created_at: string
  }[]
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
      memberAccountNumber: row.customer.member_account_number,
      fullName: row.customer.full_name,
      companyName: row.customer.company_name,
      contractNumber: row.customer.contract_number,
      contractStart: row.customer.contract_start,
      contractEnd: row.customer.contract_end,
      address: row.customer.address,
      contactNumber2: row.customer.contact_number2,
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
    filterChanges: row.filterChanges.map((f) => ({
      id: f.id,
      orderNumber: f.order_number,
      memberAccount: f.member_account,
      filterType: f.filter_type,
      planDate: f.plan_date,
      status: f.status,
      contactNumber: f.contact_number,
      address: f.address,
      sc: f.s_c,
      productNo: f.product_no,
      preD: f.pre_d ?? undefined,
      accD: f.acc_d ?? undefined,
      serviceman: f.serviceman,
      note: f.note ?? undefined,
      createdAt: f.created_at,
    })),
    collections: row.collections.map((c) => ({
      id: c.id,
      orderNo: c.order_no,
      accountName: c.account_name,
      collectionDate: c.collection_date,
      amount: Number(c.amount),
      status: c.status,
      ct: c.c_t,
      preD: c.pre_d ?? undefined,
      accD: c.acc_d ?? undefined,
      note: c.note ?? undefined,
      createdAt: c.created_at,
    })),
    repairs: row.repairs.map((r) => ({
      id: r.id,
      issuedDate: r.issued_date,
      accountName: r.account_name,
      orderNo: r.order_no,
      status: r.status,
      problem: r.problem,
      solutionStatus: r.solution_status ?? undefined,
      preD: r.pre_d ?? undefined,
      accD: r.acc_d ?? undefined,
      th: r.th,
      partNo: r.part_no ?? undefined,
      amt: Number(r.amt),
      unitInOut: r.unit_in_out,
      createdAt: r.created_at,
    })),
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
