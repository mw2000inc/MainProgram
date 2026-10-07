import { NextResponse } from "next/server"
import { runAutomation } from "@/lib/automations/engine"

export const dynamic = "force-dynamic"

// Runs on a schedule (see vercel.json). This route is just the scheduled
// trigger for the daily draft generation (Automation Hub,
// src/lib/automations/jobs/generate-draft-jobs.ts — registered as
// "generateDraftJobs", toggleable from Settings > Automations and
// re-runnable on demand from there).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Drafts the week's visits for admin review from the Filter Change /
  // install / repair / collection records — Filter Changes are generated from
  // each order's CP cycle (CP Start + its CP System's filter intervals) by the
  // database, so every Filter Change job comes from a CP-derived record. The
  // older generateFilterChangeJobs (its own due-date math, which could re-date
  // a record) is retired from this cron; see its registry entry.
  const drafts = await runAutomation("generateDraftJobs", { triggeredBy: "cron" })
  return NextResponse.json(drafts)
}
