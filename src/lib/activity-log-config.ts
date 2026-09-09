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
// detail view's before/after diff — falls back to prettifySnakeCase() (see
// below), not the literal raw key, for anything not worth a dedicated
// translated label.
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
  account_name: "fieldAccountName",
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
  // Dispatch-workflow tables (filter_change_plans/install_plans/
  // collections/repair_plans) — every real column across all four, so an
  // edit to any of them shows a proper label instead of the raw snake_case
  // key (see the Admin Approval History dialog, the main reason these were
  // added).
  id: "fieldRecordId",
  member_account: "fieldMemberAccount",
  filter_type: "fieldFilterType",
  plan_date: "fieldPlanDate",
  s_c: "fieldSC",
  product_no: "fieldProductNo",
  pre_d: "fieldPreD",
  acc_d: "fieldAccD",
  serviceman: "fieldServiceman",
  th: "fieldTechnician",
  created_at: "fieldCreatedAt",
  updated_at: "fieldUpdatedAt",
  created_by: "fieldCreatedBy",
  updated_by: "fieldUpdatedBy",
  customer_id: "fieldCustomer",
  schedule_job_id: "fieldScheduleJob",
  source: "fieldSource",
  sale_list_entry_id: "fieldSaleListEntry",
  occurrence_index: "fieldOccurrenceIndex",
  dispatch_status: "fieldDispatchStatus",
  notify_contact: "fieldNotifyContact",
  notify_phone: "fieldNotifyPhone",
  notify_email: "fieldNotifyEmail",
  requested_date: "fieldRequestedDate",
  requested_time: "fieldRequestedTime",
  customer_notified_at: "fieldCustomerNotifiedAt",
  customer_responded_at: "fieldCustomerRespondedAt",
  rejected_by: "fieldRejectedBy",
  rejected_at: "fieldRejectedAt",
  rejection_reason: "fieldRejectionReason",
  reschedule_reason: "fieldRescheduleReason",
  input_date: "fieldInputDate",
  model: "fieldModel",
  model_dp: "fieldModelDp",
  unit_price: "fieldUnitPrice",
  cp_price: "fieldCpPrice",
  delivery_installation_fee: "fieldDeliveryInstallationFee",
  pre_installed_date: "fieldPreInstalledDate",
  installed_date: "fieldInstalledDate",
  in_out: "fieldInOut",
  collection_date: "fieldCollectionDate",
  c_t: "fieldCT",
  filter_change_required: "fieldFilterChangeRequired",
  issued_date: "fieldIssuedDate",
  problem: "fieldProblem",
  solution_status: "fieldSolutionStatus",
  part_no: "fieldPartNo",
  amt: "fieldAmount",
  unit_in_out: "fieldUnitInOut",
}

// Turns an unmapped snake_case column name into a readable fallback —
// "some_new_column" -> "Some New Column" — rather than showing the literal
// raw key. Every column this app's audit trigger can realistically log
// should really have a real entry in FIELD_KEYS above; this only ever
// matters for a genuinely new column added later that hasn't been given
// one yet.
function prettifySnakeCase(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function fieldLabel(key: string, t: Translator): string {
  const tKey = FIELD_KEYS[key]
  return tKey ? t(tKey) : prettifySnakeCase(key)
}
