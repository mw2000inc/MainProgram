import { NextResponse } from "next/server"
import { runAutomation } from "@/lib/automations/engine"

export const dynamic = "force-dynamic"

// Runs on a schedule (see vercel.json). This route is just the scheduled
// trigger; the actual logic (which customers/CP-System-linked orders are
// due, idempotency checks, the two-pass generation) lives in the
// Automation Hub (src/lib/automations/jobs/generate-filter-change-jobs.ts)
// — see that file's own comment for the full policy. Registered as
// "generateFilterChangeJobs", toggleable from Settings > Automations and
// re-runnable on demand from there.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runAutomation("generateFilterChangeJobs", { triggeredBy: "cron" })
  return NextResponse.json(result)
}
