import { NextResponse } from "next/server"
import { runAutomation } from "@/lib/automations/engine"
import { purgePastDrafts } from "@/lib/automations/jobs/generate-draft-jobs"
import { createAdminClient } from "@/lib/supabase/admin"
import { businessToday } from "@/lib/dispatch-lead-time"

export const dynamic = "force-dynamic"

// Runs on a schedule (see vercel.json), same CRON_SECRET bearer-token guard
// every other cron route here already uses. This route is just the
// scheduled trigger; the actual logic (which Confirmed Filter Change/
// Collection plans are exactly 2 days out, the email/push send, the
// two_day_reminder_sent_at de-dup) lives in the Automation Hub
// (src/lib/automations/jobs/send-schedule-reminders.ts) — see that file's
// own comment for the full policy. Registered as "sendScheduleReminders",
// toggleable from Settings > Automations and re-runnable on demand from
// there, same as every other automation.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Unapproved drafts whose day has passed are deleted (their records stay,
  // unlinked, for an admin to schedule again — purgePastDrafts).
  const purged = await purgePastDrafts(createAdminClient(), businessToday())

  // First keep every unapproved Draft at 2 days' notice (same daily cron,
  // no extra Vercel schedule; toggleable separately in Settings).
  const redated = await runAutomation("redateShortNoticeDrafts", { triggeredBy: "cron" })
  const result = await runAutomation("sendScheduleReminders", { triggeredBy: "cron" })
  return NextResponse.json({ ...result, redated, purgedPastDrafts: purged })
}
