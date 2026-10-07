import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { businessToday, earliestFullNoticeDate, isShortNotice } from "@/lib/dispatch-lead-time"
import type { AutomationResult } from "../types"

// Daily safety net for the confirmation-email lead time (dispatch-lead-time.ts):
// a Draft nobody approved before its send-by date (visit − 2 days) would
// otherwise sit at short notice, and approving it later couldn't send the
// customer a confirmation with full notice. Every still-pending Draft whose
// visit is today or tomorrow is moved (its rescheduled date, Pre D) to the
// earliest date with full notice (Sunday → Monday), so it stays approvable
// in time. A Draft dated in the PAST is left alone: that's overdue backlog
// (e.g. a newly entered order's long-past first payment) needing an admin's
// decision, not a visit that just slipped — it stays under the queues'
// "Overdue" filter. Never approves, sends an email, or touches a non-Draft
// record — Step 1 (admin approval) stays with the admin. Runs before the
// reminder emails in the 6:00 AM (Manila) cron; the audit trigger records
// every move.
const TABLES = [
  { table: "filter_change_plans", pre: "pre_d", base: "plan_date", order: "order_number" },
  { table: "install_plans", pre: "pre_installed_date", base: "input_date", order: "order_no" },
  { table: "collections", pre: "pre_d", base: "collection_date", order: "order_no" },
  { table: "repair_plans", pre: "pre_d", base: "issued_date", order: "order_no" },
] as const

export async function redateShortNoticeDrafts(
  admin: SupabaseClient,
  // Restricts the run to matching order numbers (tests use disposable ones).
  opts: { onlyOrders?: (orderNo: string) => boolean; today?: string } = {}
): Promise<AutomationResult> {
  const today = opts.today ?? businessToday()
  const newDate = earliestFullNoticeDate(today)
  const moved: { table: string; order: string; from: string }[] = []
  const errors: string[] = []

  for (const t of TABLES) {
    const { data, error } = await admin.from(t.table).select(`id, ${t.pre}, ${t.base}, ${t.order}`).eq("dispatch_status", "Draft").eq("status", "Pending")
    if (error) {
      errors.push(`${t.table}: ${error.message}`)
      continue
    }
    for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
      const visit = row[t.pre] || row[t.base]
      const order = row[t.order] ?? ""
      if (!visit || visit < today || !isShortNotice(visit, today)) continue
      if (opts.onlyOrders && !opts.onlyOrders(order)) continue
      const { error: updateError } = await admin
        .from(t.table)
        .update({ [t.pre]: newDate })
        .eq("id", row.id as string)
        .eq("dispatch_status", "Draft") // approved meanwhile → left alone
      if (updateError) errors.push(`${t.table} ${order || row.id}: ${updateError.message}`)
      else moved.push({ table: t.table, order, from: visit })
    }
  }

  return {
    ok: errors.length === 0,
    message: moved.length
      ? `Moved ${moved.length} unapproved Draft(s) due today or tomorrow to ${newDate} (earliest date with 2 days' notice); ${errors.length} error(s).`
      : `No unapproved Drafts due today or tomorrow${errors.length ? `; ${errors.length} error(s)` : ""}.`,
    detail: { today, newDate, moved, errors },
  }
}

export async function runRedateShortNoticeDrafts(): Promise<AutomationResult> {
  return redateShortNoticeDrafts(createAdminClient())
}
