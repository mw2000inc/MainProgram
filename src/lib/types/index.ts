export type Role = "admin" | "technician"

// The interface language -- a per-user, synced preference (profiles.locale),
// not a company_settings-wide default; see the profile_locale migration.
export type Locale = "en" | "ko"

export interface User {
  id: string
  name: string
  email: string
  role: Role
  avatarUrl?: string
  phone?: string
  createdAt: string
  locale: Locale
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
export type SaleListStatus = "ACTIVE" | "INACTIVE" | "RENT" | "DIY"

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
  // order. When set, the filter-change scheduling cron paces off this
  // system's own components (shortest interval wins — see
  // getCpSystemFilterChangeDueDate) anchored on this order's own
  // installedDate, instead of the customer-level dispenser_type + Settings'
  // monitoring intervals fallback every other order still uses.
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
  // applicable (the filter-change auto-deduction, old and new).
  scheduleJobId?: string
  // 'pending' rows (from a completed job's recorded filter items — see
  // ScheduleJobFilterItem) have NOT been applied to products.stockQuantity
  // yet; every other write path in this app (manual entries, sale
  // deductions) always inserts 'approved' and behaves exactly as before
  // this status existed. An admin approving a pending row is what actually
  // triggers the stock deduction — see approveStockMovement. Optional (not
  // client-defaulted) so existing manual-entry code doesn't need to know
  // about it — the database column defaults to 'approved' when omitted.
  status?: "pending" | "approved"
  approvedAt?: string
  approvedBy?: string
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
  // Geocoded from `address`, client-side, on first successful "Directions"
  // lookup — see updateSettingsCoordinates. Absent until then, or if the
  // address hasn't been geocoded successfully. Cleared whenever `address`
  // itself is edited, so a stale office pin can never linger.
  latitude?: number
  longitude?: number
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

// One row from public.schedule_job_filter_items — the filters (and
// quantities) a technician/admin recorded as required when completing a job
// (any jobType, not just "filter_change" — a repair or install visit can
// surface the same need). This is the single source of truth for "which
// filters, how many": filter_change_plans/collections link to the job via
// scheduleJobId and read this list live rather than keeping their own copy.
// Inserting one automatically creates/reuses that job's Filter Change and
// Collection records and a pending stock movement — see the
// ct_filter_change_collection_inventory_link migration.
export interface ScheduleJobFilterItem {
  id: string
  scheduleJobId: string
  productId: string
  quantity: number
  createdAt: string
}

// Admin-gated customer dispatch confirmation workflow (see the
// dispatch_confirmation_workflow migration) — shared by all four plan
// tables. A record only becomes eligible for the Daily Report once
// dispatchStatus reaches 'Confirmed': either it's grandfathered there by
// the migration's own default (every pre-existing row, and every row any
// other insert path — recurring-schedule generation, C/T completion —
// still creates), or an admin explicitly approved it from 'Draft' (see
// DispatchApprovalQueue) and the customer then confirmed via their
// /confirm/[token] link.
export type DispatchStatus = "Draft" | "Pending Customer Confirmation" | "Confirmed" | "Reschedule Requested"

export interface DispatchFields {
  dispatchStatus?: DispatchStatus
  // Superseded by notifyPhone/notifyEmail below (see the
  // dispatch_dual_channel_notifications migration) — left in the type for
  // any pre-existing row approved before that migration ran, but no longer
  // written to by anything new.
  notifyContact?: string
  notifyPhone?: string
  notifyEmail?: string
  customerNotifiedAt?: string
  customerRespondedAt?: string
  // Only meaningful when dispatchStatus is 'Reschedule Requested' — the
  // customer's own proposed replacement date/time (see the
  // reschedule_request_with_date migration). requestedTime is a courtesy
  // display detail only, never applied to pre_d or any other real
  // schedule field.
  requestedDate?: string
  requestedTime?: string
}

export interface FilterChangePlan extends DispatchFields {
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
  // Links back to the real customer/job this plan is for — absent on any
  // plan created the old way (typed in directly on this page), present on
  // one auto-created from a completed job's filter items. Optional (rather
  // than defaulted client-side) so existing manual-creation code doesn't
  // need to know about it — the database column default ('manual') applies
  // whenever it's omitted.
  customerId?: string
  scheduleJobId?: string
  // 'ct_completion' for a plan auto-created/updated by a job completion;
  // 'recurring_schedule' for one generated automatically every 3 months
  // from the sale list entry's Plan D (see the filter_change_recurring_
  // schedule migration); 'manual' (the default) for one an admin typed in
  // directly on this page.
  source?: "manual" | "ct_completion" | "recurring_schedule"
  // Present only on a 'recurring_schedule' row — which sale list entry and
  // which occurrence (1 = month 3, 2 = month 6, ...) this plan is for.
  saleListEntryId?: string
  occurrenceIndex?: number
  preD?: string
  accD?: string
  serviceman: string
  note?: string
  createdAt: string
}

export interface InstallPlan extends DispatchFields {
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
  // Set once a customer confirms this dispatch (see the
  // auto_create_schedule_job_on_confirm migration) -- links to the
  // Schedule panel entry (schedule_jobs) auto-created/reused for it.
  scheduleJobId?: string
}

export interface RepairPlan extends DispatchFields {
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
  // Set once a customer confirms this dispatch (see the
  // auto_create_schedule_job_on_confirm migration) -- links to the
  // Schedule panel entry (schedule_jobs) auto-created/reused for it.
  scheduleJobId?: string
}

export interface CollectionPlan extends DispatchFields {
  id: string
  orderNo: string
  accountName: string
  collectionDate: string
  amount: number
  status: string
  // The old AppSheet-imported "C/T" free-text field. Manually-entered rows
  // leave it exactly as typed; a source='recurring_schedule' row (see
  // saleListEntryId below) has it set from the sale list entry's own C/T,
  // and a source='ct_completion' row (job completion) doesn't touch it.
  ct: string
  preD?: string
  accD?: string
  note?: string
  createdAt: string
  // Same linking/tagging pattern as FilterChangePlan — see its comments.
  // Both optional (rather than defaulted client-side) so existing manual-
  // creation code doesn't need to know about them at all — the database
  // column defaults ('manual' / false) apply whenever they're omitted.
  customerId?: string
  scheduleJobId?: string
  source?: "manual" | "ct_completion" | "recurring_schedule"
  // Set true the moment a completed job records filter items for this
  // customer — the actual filter list lives on schedule_job_filter_items
  // (via scheduleJobId), not duplicated here.
  filterChangeRequired?: boolean
  // Present only for a source='recurring_schedule' row — see the
  // collection_recurring_schedule migration. occurrenceIndex is this
  // occurrence's stable position in its series (0, 1, 2, ...) — it never
  // changes even if collectionDate is later edited, which is exactly what
  // lets editing one occurrence re-anchor the later ones without losing
  // track of which row is which.
  saleListEntryId?: string
  occurrenceIndex?: number
}
