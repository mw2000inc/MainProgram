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
  // fullName/companyName double as "Member List" Contact Person / Account Name —
  // companyName falls back to fullName when a member has no separate company.
  fullName: string
  companyName?: string
  memberAccountNumber: string
  contractNumber: string
  contractStart: string
  contractEnd: string
  address: string
  address2?: string
  email: string
  email2?: string
  contactNumber: string
  contactNumber2?: string
  tin?: string
  dispenserType: string
  filterInstalled: boolean
  installedDate?: string
  assignedTechnician: string
  notes?: string
  createdAt: string
  isSystem?: boolean
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
  shipping?: number
  totalAmount: number
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
}

// "Sale List" — a per-Member install/care-plan record (order/product/coverage
// tracking), distinct from the invoicing Sale above.
export type SaleListStatus = "ACTIVE" | "INACTIVE" | "RENT"

export interface SaleListEntry {
  id: string
  orderNumber: string
  installedDate?: string
  customerId?: string
  productNo: string
  sc: string
  cf: string
  ct: string
  cpY1Y2: string
  cpStart?: string
  cpEnd?: string
  note?: string
  status: SaleListStatus
  createdAt: string
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
  | "Filter Change"

export interface StockMovement {
  id: string
  date: string
  createdAt: string
  productId: string
  quantityAdded: number
  quantityRemoved: number
  secondHandReadyQuantity: number
  secondHandRepairQuantity: number
  demoQuantity: number
  reason: StockMovementReason
  // Absent for system-triggered movements (e.g. the filter-change deduction
  // cron) — every manual movement still always sets this.
  userId?: string
  referenceNumber: string
  // Traceability back to the schedule job that triggered this movement, when
  // applicable (currently only the filter-change auto-deduction).
  scheduleJobId?: string
}

export type NotificationType =
  | "low-stock"
  | "out-of-stock"
  | "expiring-contract"
  | "new-customer"
  | "new-sale"

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
  // Admin-customized panel order for the Daily Report page, shared across every
  // viewer. Empty until an admin drags a panel, at which point it holds every
  // known panel id in order — see DAILY_REPORT_PANEL_IDS.
  dailyReportLayout: string[]
  // Admin-customized, shared panel sizes for the Daily Report page, keyed by the
  // same panel id used for dailyReportLayout. Missing entries mean "natural size."
  dailyReportPanelSizes: Record<string, PanelSize>
  // "stacked" (default): every panel in one draggable, individually-resizable
  // column. "grid": Filter Change/Installation/Repair/Collection render as a
  // fixed 2x2 block instead (not draggable or resizable while in this mode) —
  // everything else is unaffected. Shared across every viewer, same as the
  // fields above.
  dailyReportLayoutMode: "stacked" | "grid"
}

export interface PanelSize {
  width?: number
  height?: number
}

export interface Announcement {
  id: string
  title: string
  body: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface AnnouncementComment {
  id: string
  announcementId: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  updatedAt: string
}

export type ScheduleJobType = "installation" | "filter_change" | "repair" | "collection" | "monitoring" | "other"
export type ScheduleJobStatus = "pending" | "completed" | "cancelled"

export interface ScheduleJob {
  id: string
  jobType: ScheduleJobType
  technician: string
  // Optional second technician for jobs that need two people (e.g. a
  // pull-out + install combo) — most jobs leave this unset.
  //
  // technician2 is deliberately just a second name column on this SAME row,
  // not a link to a second schedule_jobs record. That's what guarantees the
  // shared-schedule invariant: scheduledDate/status/customerId/orderNo below
  // are singular fields on the one row, so both technicians read the exact
  // same date/status/customer/order by construction — there is no way for
  // them to diverge, because there's nowhere on this type to store a second
  // value for any of those fields. If a future change ever needs a
  // per-technician date or status, do NOT add it here — that would silently
  // break every job that currently has two technicians sharing one schedule.
  technician2?: string
  customerId?: string
  orderNo?: string
  scheduledDate: string
  status: ScheduleJobStatus
  notes?: string
  remarks?: string
  createdAt: string
  // The following three only apply to jobType "filter_change" — which
  // Inventory item + how many units to deduct once this job is marked
  // completed, and when that deduction actually happened (the idempotency
  // guard: the cron only ever deducts a given job once).
  productId?: string
  quantity?: number
  inventoryDeductedAt?: string
}

export interface FilterChangePlan {
  id: string
  orderNumber: string
  memberAccount: string
  filterType: string
  planDate: string
  status: string
  contactNumber: string
  address: string
  sc: string
  productNo: string
  preD?: string
  accD?: string
  serviceman: string
  note?: string
  createdAt: string
}

export interface InstallPlan {
  id: string
  name: string
  orderNo: string
  inputDate: string
  address: string
  status: string
  contactNumber: string
  model: string
  unitPrice: number
  cpPrice: number
  deliveryInstallationFee: number
  preInstalledDate?: string
  installedDate?: string
  note?: string
  modelDp?: string
  inOut: string
  createdAt: string
}

export interface RepairPlan {
  id: string
  issuedDate: string
  accountName: string
  orderNo: string
  status: string
  problem: string
  solutionStatus?: string
  preD?: string
  accD?: string
  th: string
  partNo?: string
  amt: number
  unitInOut: string
  createdAt: string
}

export interface CollectionPlan {
  id: string
  orderNo: string
  accountName: string
  collectionDate: string
  amount: number
  status: string
  ct: string
  preD?: string
  accD?: string
  note?: string
  createdAt: string
}
