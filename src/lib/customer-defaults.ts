import { format } from "date-fns"
import { todayIso } from "@/lib/utils"

// The sensible, already-established fallback for whatever a brand-new
// Customer record doesn't have real data for yet — originally the Add
// Member form's own answer to "the customers table requires
// contract_start/contract_end/dispenser_type on insert, but this form
// doesn't collect them": a fresh one-year contract starting today, an
// unset dispenser type/technician, and filterInstalled defaulted to false
// rather than asserted true without evidence. Shared rather than
// duplicated so every place that can create a bare-minimum Customer (the
// Add Member form, and Install's own auto-create-a-member-from-a-new-order
// flow) agrees on the same "we don't actually know yet" defaults.
export function newMemberDefaults() {
  const oneYearLater = new Date()
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1)
  return {
    dispenserType: "",
    contractStart: todayIso(),
    contractEnd: format(oneYearLater, "yyyy-MM-dd"),
    assignedTechnician: "",
    filterInstalled: false,
  }
}
