// Removes auto-generated Filter Change schedule jobs that the old automation
// created off an order's FIRST-ever due date (the "due 2019-…" jobs), and puts
// back the Filter Change visits the schedule sync linked to them.
//
// Dry run by default — prints what it would do and changes nothing:
//   node scripts/cleanup-auto-filter-change-jobs.mts
// Apply (writes a JSON backup to your temp folder first):
//   node scripts/cleanup-auto-filter-change-jobs.mts --apply
//
// Options:
//   --date=YYYY-MM-DD   only jobs the automation created that day (UTC). Default 2026-10-02.
//   --date=all          every pending automation job, any creation day.
//   --window=N          keep jobs whose order's CURRENT cycle came due within the last N days
//                       (same rule as the fixed automation). Default: the automation's own limit (7).
//   --remove-all        remove every matching job, ignoring the window.
//
// Per job removed:
//   - a Filter Change visit the sync CREATED for it (no other trace) is deleted —
//     only while still Pending, not completed, with no inventory items and no later edits;
//   - a visit the sync LINKED is unlinked and its Planned date (Pre D), technicians,
//     filters and 2-day-reminder flag are restored from the audit log — each only if
//     nobody has changed it since;
//   - the job is deleted.
// Jobs an admin has already edited (anything in the audit log after creation) are kept.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { AUTO_FILTER_CHANGE_EARLY_DONE_DAYS, AUTO_FILTER_CHANGE_MAX_OVERDUE_DAYS, currentFilterChangeDue } from "../src/lib/filter-change-cycle.ts"

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=")
    return [k, v ?? "true"]
  })
)
const APPLY = args.apply === "true"
const DATE = args.date ?? "2026-10-02"
const WINDOW = Number(args.window ?? AUTO_FILTER_CHANGE_MAX_OVERDUE_DAYS)
const REMOVE_ALL = args["remove-all"] === "true"
const TODAY = new Date().toISOString().slice(0, 10)
const RESTORABLE = ["pre_d", "serviceman", "serviceman_2", "filter_type", "two_day_reminder_sent_at"] as const

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

type Row = Record<string, unknown> & { id: string }
async function all<T = Row>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data as T[]))
    if ((data as T[]).length < 1000) break
  }
  return out
}
async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 150) out.push(...(await fetch(ids.slice(i, i + 150))))
  return out
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const minutesAfter = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000

// --- jobs -------------------------------------------------------------------
const jobQuery = (from: number, to: number) => {
  let q = sb
    .from("schedule_jobs")
    .select("*")
    .eq("source", "automation")
    .eq("job_type", "filter_change")
    .eq("status", "pending")
  if (DATE !== "all") q = q.gte("created_at", `${DATE}T00:00:00Z`).lt("created_at", `${DATE}T23:59:59.999Z`)
  return q.order("created_at").range(from, to)
}
const jobs = await all<Row & { order_no: string; created_at: string; scheduled_date: string; notes: string | null }>(jobQuery)
const jobIds = jobs.map((j) => j.id)

const jobLogs = await inChunks(jobIds, async (c) =>
  all<{ entity_id: string; action: string }>((f, t) =>
    sb.from("activity_logs").select("entity_id, action").eq("entity_type", "schedule_jobs").eq("action", "update").in("entity_id", c).range(f, t)
  )
)
const editedJobs = new Set(jobLogs.map((l) => l.entity_id))

// --- current-cycle check (same rule as the fixed automation) -----------------
const orders = await all<{ order_number: string; installed_date: string | null; cp_systems: { components: { intervalMonths: number }[] } | null }>(
  (f, t) => sb.from("sale_list_entries").select("order_number, installed_date, cp_systems(components)").not("cp_system_id", "is", null).range(f, t)
)
const orderByNo = new Map(orders.map((o) => [o.order_number?.trim(), o]))
const lastDone = new Map<string, string>()
for (const r of await all<{ order_number: string; acc_d: string }>((f, t) =>
  sb.from("filter_change_plans").select("order_number, acc_d").not("acc_d", "is", null).neq("status", "Cancelled").range(f, t)
)) {
  const o = r.order_number?.trim()
  if (o && r.acc_d > (lastDone.get(o) ?? "")) lastDone.set(o, r.acc_d)
}
function currentCycle(orderNo: string): { keep: boolean; due: string | null; why: string } {
  const o = orderByNo.get(orderNo.trim())
  const intervals = (o?.cp_systems?.components ?? []).map((c) => c.intervalMonths).filter((n) => n > 0)
  if (!o?.installed_date || intervals.length === 0) return { keep: false, due: null, why: "no CP System anchor" }
  const due = currentFilterChangeDue(o.installed_date, Math.min(...intervals), TODAY)
  if (!due) return { keep: false, due, why: "not due yet" }
  const overdue = daysBetween(due, TODAY)
  if (overdue > WINDOW) return { keep: false, due, why: `current cycle ${overdue} days overdue` }
  const done = lastDone.get(orderNo.trim())
  if (done && daysBetween(done, due) <= AUTO_FILTER_CHANGE_EARLY_DONE_DAYS) return { keep: false, due, why: "already done this cycle" }
  return { keep: true, due, why: `due ${due} (${overdue} days ago)` }
}

// --- linked visits and their audit trail ------------------------------------
const plans = await inChunks(jobIds, async (c) =>
  all<Row & { schedule_job_id: string; created_at: string; status: string; acc_d: string | null }>((f, t) =>
    sb.from("filter_change_plans").select("*").in("schedule_job_id", c).range(f, t)
  )
)
const planIds = plans.map((p) => p.id)
const planLogs = await inChunks(planIds, async (c) =>
  all<{ entity_id: string; action: string; created_at: string; old_values: Record<string, unknown>; new_values: Record<string, unknown> }>((f, t) =>
    sb.from("activity_logs").select("entity_id, action, created_at, old_values, new_values").eq("entity_type", "filter_change_plans").in("entity_id", c).order("created_at").range(f, t)
  )
)
const movementPlans = new Set(
  (await inChunks(planIds, async (c) => all<{ filter_change_plan_id: string }>((f, t) => sb.from("stock_movements").select("filter_change_plan_id").in("filter_change_plan_id", c).range(f, t)))).map(
    (m) => m.filter_change_plan_id
  )
)

type PlanAction =
  | { kind: "delete"; plan: Row }
  | { kind: "restore"; plan: Row; patch: Record<string, unknown>; skipped: string[] }
  | { kind: "keep-created"; plan: Row; why: string }
const plan_actions: PlanAction[] = []
const removeJobs: typeof jobs = []
const keepJobs: { job: (typeof jobs)[number]; why: string }[] = []

for (const job of jobs) {
  if (editedJobs.has(job.id)) {
    keepJobs.push({ job, why: "edited by an admin after creation" })
    continue
  }
  const cycle = currentCycle(job.order_no ?? "")
  if (!REMOVE_ALL && cycle.keep) {
    keepJobs.push({ job, why: cycle.why })
    continue
  }
  removeJobs.push(job)
  for (const plan of plans.filter((p) => p.schedule_job_id === job.id)) {
    const logs = planLogs.filter((l) => l.entity_id === plan.id)
    const createdBySync = minutesAfter(job.created_at, plan.created_at) >= 0 && minutesAfter(job.created_at, plan.created_at) < 15
    if (createdBySync) {
      const laterEdits = logs.filter((l) => l.action === "update")
      if (plan.status !== "Pending" || plan.acc_d || movementPlans.has(plan.id) || laterEdits.length > 0) {
        plan_actions.push({ kind: "keep-created", plan, why: "visit was worked on since — unlinked only" })
      } else plan_actions.push({ kind: "delete", plan })
      continue
    }
    const linkLog = logs.find((l) => l.action === "update" && l.new_values?.schedule_job_id === job.id)
    const patch: Record<string, unknown> = { schedule_job_id: null }
    const skipped: string[] = []
    if (linkLog) {
      for (const key of RESTORABLE) {
        if (!(key in linkLog.new_values)) continue
        const changedSince = logs.some((l) => l.created_at > linkLog.created_at && l.action === "update" && key in l.new_values)
        if (changedSince || plan[key] !== linkLog.new_values[key]) skipped.push(key)
        else patch[key] = linkLog.old_values[key] ?? null
      }
    } else skipped.push("no audit record — planned date left as is")
    plan_actions.push({ kind: "restore", plan, patch, skipped })
  }
}

// --- report -----------------------------------------------------------------
const deletes = plan_actions.filter((a) => a.kind === "delete")
const restores = plan_actions.filter((a): a is Extract<PlanAction, { kind: "restore" }> => a.kind === "restore")
const keptCreated = plan_actions.filter((a) => a.kind === "keep-created")
const dueYears: Record<string, number> = {}
for (const j of removeJobs) {
  const y = (j.notes ?? "").match(/due (\d{4})/)?.[1] ?? "?"
  dueYears[y] = (dueYears[y] ?? 0) + 1
}
console.log(`${APPLY ? "APPLY" : "DRY RUN"} — automation jobs created ${DATE === "all" ? "on any day" : `on ${DATE}`}, ${REMOVE_ALL ? "removing all" : `keeping orders due within ${WINDOW} days`}`)
console.log(`  pending automation jobs found: ${jobs.length}`)
console.log(`  jobs to remove: ${removeJobs.length}   (by the old note's due year: ${JSON.stringify(dueYears)})`)
console.log(`  jobs kept: ${keepJobs.length}`)
const keepReasons: Record<string, number> = {}
for (const k of keepJobs) keepReasons[k.why.replace(/\d{4}-\d{2}-\d{2} \(\d+ days ago\)/, "within window")] = (keepReasons[k.why.replace(/\d{4}-\d{2}-\d{2} \(\d+ days ago\)/, "within window")] ?? 0) + 1
if (keepJobs.length) console.log(`    why kept: ${JSON.stringify(keepReasons)}`)
console.log(`  visits created by the sync, to delete: ${deletes.length}${keptCreated.length ? ` (+${keptCreated.length} worked on since — unlinked only)` : ""}`)
console.log(`  linked visits to unlink + restore: ${restores.length}`)
const restoredKeys: Record<string, number> = {}
for (const r of restores) for (const k of Object.keys(r.patch)) if (k !== "schedule_job_id") restoredKeys[k] = (restoredKeys[k] ?? 0) + 1
console.log(`    fields restored: ${JSON.stringify(restoredKeys)}`)
const notRestored = restores.filter((r) => r.skipped.length > 0)
if (notRestored.length) {
  console.log(`    ${notRestored.length} visit(s) with something not restored:`)
  for (const r of notRestored.slice(0, 15)) console.log(`      ${r.plan.order_number} (pre_d ${r.plan.pre_d}, plan_date ${r.plan.plan_date}): ${r.skipped.join("; ")}`)
}

if (!APPLY) {
  console.log("\nNothing changed. Re-run with --apply to make these changes.")
  process.exit(0)
}

// --- apply ------------------------------------------------------------------
const backup = path.join(os.tmpdir(), `auto-filter-change-cleanup-${Date.now()}.json`)
fs.writeFileSync(backup, JSON.stringify({ args, jobs: removeJobs, plans: plan_actions.map((a) => a.plan) }, null, 2))
console.log(`\nBackup written: ${backup}`)
for (const a of restores) {
  const { error } = await sb.from("filter_change_plans").update(a.patch).eq("id", a.plan.id)
  if (error) throw new Error(`restore ${a.plan.id}: ${error.message}`)
}
for (const a of keptCreated) {
  const { error } = await sb.from("filter_change_plans").update({ schedule_job_id: null }).eq("id", a.plan.id)
  if (error) throw new Error(`unlink ${a.plan.id}: ${error.message}`)
}
const delPlanIds = deletes.map((a) => a.plan.id)
for (let i = 0; i < delPlanIds.length; i += 150) {
  const { error } = await sb.from("filter_change_plans").delete().in("id", delPlanIds.slice(i, i + 150))
  if (error) throw new Error(`delete visits: ${error.message}`)
}
const delJobIds = removeJobs.map((j) => j.id)
for (let i = 0; i < delJobIds.length; i += 150) {
  const { error } = await sb.from("schedule_jobs").delete().in("id", delJobIds.slice(i, i + 150)).eq("status", "pending").eq("source", "automation")
  if (error) throw new Error(`delete jobs: ${error.message}`)
}
console.log(`Done: ${restores.length} visit(s) restored, ${deletes.length} visit(s) deleted, ${removeJobs.length} job(s) removed.`)
