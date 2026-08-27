export type Role = "admin" | "technician"

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
  // Geocoded from `address`, client-side, on first Member List map render —
  // see 20260825010000_customer_geocoded_coordinates.sql. Absent until then.
  latitude?: number
  longitude?: number
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
  // Which CP System (see CpSystem below) was actually installed for this
  // order — not yet read by the filter-change scheduling cron, which still
  // runs on the customer's dispenser_type + Settings' monitoring intervals.
  cpSystemId?: string
}

// "CP System" — a catalog of system codes (UF71, RO71, etc.) and the filter
// components each is built from, replacing the old AppSheet "MW CP > CP
// System" reference table. Each component has its own replacement interval
// rather than one combined free-text description, per-order via
// SaleListEntry.cpSystemId above.
export interface CpSystemComponent {
  name: string
  intervalMonths: number
}

export interface CpSystem {
  id: string
  systemCode: string
  components: CpSystemComponent[]
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
}

export interface PanelSize {
  width?: number
  height?: number
}

// Each admin's own Daily Report layout — see daily_report_layouts (one row
// per user, RLS-scoped to its owner). A technician never reads or writes
// this; they always see the hardcoded default order/sizes/mode.
export interface DailyReportLayout {
  layout: string[]
  panelSizes: Record<string, PanelSize>
  layoutMode: "stacked" | "grid"
}

export type DailyReportSectionKey = "schedule" | "announcements" | "installation" | "filter_change" | "collection" | "repair"

// The Daily Report's admin-configurable section list — see
// daily_report_sections, a single SHARED table (unlike DailyReportLayout
// above): an admin's changes here affect every viewer's Daily Report,
// technicians included, who can only ever read it. sectionKey is fixed —
// there's no way to add a section beyond these six (see the migration's own
// comment for why) — enabled/label/displayOrder/visibleFields are what an
// admin can actually change.
export interface DailyReportSectionConfig {
  sectionKey: DailyReportSectionKey
  label: string
  enabled: boolean
  displayOrder: number
  // Which of that section's columns to show — empty means "show all".
  // Meaningless for "schedule"/"announcements" (not column-table panels).
  visibleFields: string[]
}

// One row from public.activity_logs — written exclusively by the
// log_audit_event() trigger (see the audit_logging migration), never by
// application code, so userId always reflects the actual authenticated
// admin who made the change (or a technician, for the handful of tables
// they can still write to, e.g. marking their own schedule job done).
// oldValues/newValues hold only the columns that actually changed on an
// update — the full row on insert/delete.
export interface ActivityLogEntry {
  id: string
  userId?: string
  userName: string
  action: "insert" | "update" | "delete"
  entityType?: string
  entityId?: string
  description?: string
  oldValues: Record<string, unknown>
  newValues: Record<string, unknown>
  createdAt: string
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
  // Links this job to a real technician account, purely for RLS scoping (a
  // technician session can only ever read jobs where this equals their own
  // id — see the schedule_jobs_select policy). The free-text technician/
  // technician2 fields above are the source of truth for who's actually
  // display/print/exported as assigned; this is separate and admin-set.
  technicianUserId?: string
  // Same purpose as technicianUserId above, for the technician2 name field —
  // lets a shared two-technician job show up on BOTH linked accounts'
  // Schedule views without creating a second schedule_jobs row (see
  // schedule_jobs_select: technician_user_id = auth.uid() OR
  // technician_2_user_id = auth.uid()).
  technician2UserId?: string
  customerId?: string
  orderNo?: string
  scheduledDate: string
  // Free text ("ANYTIME", "MORNING", "2:00 PM") rather than a strict time
  // type — matches how these were actually recorded in the old AppSheet
  // source. Only rendered on the Table View; not required.
  scheduledTime?: string
  status: ScheduleJobStatus
  notes?: string
  remarks?: string
  createdAt: string
  // A second location for this same job (e.g. a pull-out address distinct
  // from the install address) — see the technician2 comment above for why
  // this is a second field on the one row rather than a second job.
  secondaryAddress?: string
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
