import type { ActivityLogEntry } from "@/lib/types"

type Translator = (key: string) => string

// Maps a raw table name (activity_logs.entity_type, set by the audit
// trigger to TG_TABLE_NAME) to what the Admin Activity page shows in its
// "Record" column. Keyed to activity.json's entity* keys rather than
// returning text directly, so every call site can render it in the
// current interface language — pass the `t` from useTranslation("activity").
const ENTITY_TYPE_KEYS: Record<string, string> = {
  customers: "entityCustomer",
  sales: "entitySale",
  schedule_jobs: "entitySchedule",
  install_plans: "entityInstallation",
  filter_change_plans: "entityFilterChange",
  collections: "entityCollection",
  repair_plans: "entityRepair",
  products: "entityProduct",
  suppliers: "entitySupplier",
  stock_movements: "entityStockMovement",
  company_settings: "entitySettings",
  announcements: "entityAnnouncement",
  profiles: "entityUser",
  daily_report_sections: "entityDailyReportSettings",
  sale_list_entries: "entitySaleListEntry",
  cp_systems: "entityCpSystem",
  schedule_job_filter_items: "entityFilterItem",
}

export function entityTypeLabel(entityType: string | undefined, t: Translator): string {
  if (!entityType) return t("entityRecord")
  const key = ENTITY_TYPE_KEYS[entityType]
  return key ? t(key) : entityType
}

const ACTION_KEYS: Record<ActivityLogEntry["action"], string> = {
  insert: "actionAdded",
  update: "actionUpdated",
  delete: "actionDeleted",
}

export function actionLabel(action: ActivityLogEntry["action"], t: Translator): string {
  return t(ACTION_KEYS[action])
}

// A human-readable field name for a raw column key, shown in the entry
// detail view's before/after diff — falls back to the raw key (still
// readable enough) for anything not worth a friendlier label.
const FIELD_KEYS: Record<string, string> = {
  scheduled_date: "fieldScheduledDate",
  scheduled_time: "fieldScheduledTime",
  status: "fieldStatus",
  technician: "fieldTechnician",
  technician_2: "fieldTechnician2",
  technician_user_id: "fieldTechnicianAccount",
  technician_2_user_id: "fieldTechnician2Account",
  full_name: "fieldFullName",
  company_name: "fieldAccountName",
  contact_number: "fieldContactNumber",
  contract_start: "fieldContractStart",
  contract_end: "fieldContractEnd",
  order_no: "fieldOrderNo",
  order_number: "fieldOrderNumber",
  name: "fieldName",
  email: "fieldEmail",
  role: "fieldRole",
  address: "fieldAddress",
  amount: "fieldAmount",
  notes: "fieldNotes",
  note: "fieldNote",
  title: "fieldTitle",
  body: "fieldBody",
  label: "fieldLabel",
  enabled: "fieldEnabled",
  display_order: "fieldDisplayOrder",
}

export function fieldLabel(key: string, t: Translator): string {
  const tKey = FIELD_KEYS[key]
  return tKey ? t(tKey) : key
}
