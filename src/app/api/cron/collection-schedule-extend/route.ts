import { NextResponse } from "next/server"
import { runAutomation } from "@/lib/automations/engine"

export const dynamic = "force-dynamic"

// Runs on a schedule (see vercel.json) — both the recurring Collection
// schedule and the recurring Filter Change schedule are rolling windows
// (see the collection_schedule_rolling_window and
// filter_change_recurring_schedule migrations): each always covers
// "today + 2 years" ahead rather than being capped at CP End, so as today
// advances, previously-out-of-window occurrences come into range and need
// generating. Both share this one cron entry rather than getting a second
// one, since Vercel's Hobby plan caps the number of cron jobs a project can
// have — this route is just the scheduled trigger; the actual logic lives
// in the Automation Hub (src/lib/automations/*), the same registered
// automations Settings > Automations can toggle off or an admin can
// re-run manually from there.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [collection, filterChange] = await Promise.all([
    runAutomation("extendCollectionSchedule", { triggeredBy: "cron" }),
    runAutomation("extendFilterChangeSchedule", { triggeredBy: "cron" }),
  ])

  return NextResponse.json({ collection, filterChange })
}
