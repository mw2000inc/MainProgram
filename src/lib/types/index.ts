export type Role = "admin" | "staff"

export interface User {
  id: string
  name: string
  email: string
  role: Role
  avatarUrl?: string
  phone?: string
  createdAt: string
}

export type ContractStatus = "active" | "expiring" | "expired"

export interface Customer {
  id: string
  orderNumber: string
  fullName: string
  companyName?: string
  contractNumber: string
  contractStart: string
  contractEnd: string
  address: string
  email: string
  contactNumber: string
  dispenserType: string
  filterInstalled: boolean
  installedDate?: string
  assignedTechnician: string
  notes?: string
  createdAt: string
  // True for the one generic placeholder customer (fallback when a Shopify
  // order has no usable buyer info) — hidden from Customers/Contracts/
  // Dashboard entirely.
  isSystem?: boolean
  // True for a real per-buyer customer auto-created/matched from a Shopify
  // order — shows normally in Customers/Sales/Dashboard, but has no
  // installed unit, so it's excluded from Contracts/Quarterly Monitoring
  // the same way isSystem is.
  isShopifyCustomer?: boolean
  // Shopify's own customer id — the stable key repeat orders are matched
  // against, since it survives an email change; null for guest checkouts.
  shopifyCustomerId?: string
}

export type MonitoringStatus = "active" | "for-replacement"

// Customer-facing quarterly-monitoring status (three buckets) shown on the public
// scan page, derived from the monitoring End Date rather than the contract end.
export type MonitoringViewStatus = "active" | "expiring" | "for-replacement"

export interface Contract {
  id: string
  customerId: string
  contractNumber: string
  startDate: string
  endDate: string
}

export type PaymentMethod = "Cash" | "Bank Transfer" | "Credit Card" | "GCash" | "Check"
export type PaymentStatus = "Paid" | "Pending" | "Overdue" | "Partial"

export interface SaleItem {
  id: string
  productId: string
  quantity: number
  unitPrice: number
  subtotal: number
}

export interface SaleService {
  id: string
  name: string
  quantity: number
  unitPrice: number
  subtotal: number
}

export interface Sale {
  id: string
  invoiceNumber: string
  date: string
  customerId: string
  salesRepId: string
  items: SaleItem[]
  services: SaleService[]
  discount: number
  totalAmount: number
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  // Present only for sales auto-created by the Shopify order webhook — also
  // doubles as the idempotency key that prevents double-processing a
  // redelivered webhook.
  shopifyOrderId?: string
}

export type StockStatus = "in-stock" | "low-stock" | "out-of-stock"

export interface Product {
  id: string
  name: string
  category: string
  supplierId: string
  sku: string
  barcode?: string
  stockQuantity: number
  minStockLevel: number
  purchasePrice: number
  sellingPrice: number
  dateAdded: string
  lastUpdated: string
}

export interface Supplier {
  id: string
  name: string
  contact: string
  email: string
  address: string
}

export type StockMovementReason =
  | "Sale"
  | "Restock"
  | "Return"
  | "Damaged"
  | "Adjustment"

export interface StockMovement {
  id: string
  date: string
  createdAt: string
  productId: string
  quantityAdded: number
  quantityRemoved: number
  secondHandQuantity: number
  reason: StockMovementReason
  userId: string
  referenceNumber: string
}

export type NotificationType =
  | "low-stock"
  | "out-of-stock"
  | "expiring-contract"
  | "new-customer"
  | "new-sale"
  | "shopify-sku-not-found"

export interface AppNotification {
  id: string
  type: NotificationType
  message: string
  isRead: boolean
  createdAt: string
  relatedEntityId?: string
}

export interface ActivityLog {
  id: string
  userId: string
  action: string
  date: string
  time: string
  ipAddress: string
}

export interface ContactEntry {
  label: string
  value: string
}

export interface CompanySettings {
  companyName: string
  companyLogoUrl?: string
  supportEmail: string
  emailNotificationsEnabled: boolean
  currency: string
  taxRate: number
  address: string
  contactNumbers: ContactEntry[]
  contactEmails: ContactEntry[]
  // Quarterly-monitoring interval used to compute each customer's next
  // monitoring/replacement due date. `monitoringIntervals` maps a Water
  // Purification Type (dispenserType) to a number of months; types absent from
  // the map fall back to `monitoringDefaultMonths`.
  monitoringDefaultMonths: number
  monitoringIntervals: Record<string, number>
}
