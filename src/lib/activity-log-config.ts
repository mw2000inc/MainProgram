import type { ActivityLogEntry } from "@/lib/types"

// Maps a raw table name (activity_logs.entity_type, set by the audit
// trigger to TG_TABLE_NAME) to what the Admin Activity page shows in its
// "Record" column.
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  customers: "Customer",
  sales: "Sale",
  schedule_jobs: "Schedule",
  install_plans: "Installation",
  filter_change_plans: "Filter Change",
  collections: "Collection",
  repair_plans: "Repair",
  products: "Product",
  suppliers: "Supplier",
  stock_movements: "Stock Movement",
  company_settings: "Settings",
  announcements: "Announcement",
  profiles: "User",
  daily_report_sections: "Daily Report Settings",
  sale_list_entries: "Sale List Entry",
  cp_systems: "CP System",
}

export function entityTypeLabel(entityType: string | undefined): string {
  if (!entityType) return "Record"
  return ENTITY_TYPE_LABELS[entityType] ?? entityType
}

const ACTION_LABELS: Record<ActivityLogEntry["action"], string> = {
  insert: "Added",
  update: "Updated",
  delete: "Deleted",
}

export function actionLabel(action: ActivityLogEntry["action"]): string {
  return ACTION_LABELS[action]
}

// A human-readable field name for a raw column key, shown in the entry
// detail view's before/after diff — falls back to the raw key (still
// readable enough) for anything not worth a friendlier label.
const FIELD_LABELS: Record<string, string> = {
  scheduled_date: "Scheduled Date",
  scheduled_time: "Scheduled Time",
  status: "Status",
  technician: "Technician",
  technician_2: "Technician 2",
  technician_user_id: "Technician Account",
  technician_2_user_id: "Technician 2 Account",
  full_name: "Full Name",
  company_name: "Account Name",
  contact_number: "Contact Number",
  contract_start: "Contract Start",
  contract_end: "Contract End",
  order_no: "Order No",
  order_number: "Order Number",
  name: "Name",
  email: "Email",
  role: "Role",
  address: "Address",
  amount: "Amount",
  notes: "Notes",
  note: "Note",
  title: "Title",
  body: "Body",
  label: "Label",
  enabled: "Enabled",
  display_order: "Display Order",
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}
