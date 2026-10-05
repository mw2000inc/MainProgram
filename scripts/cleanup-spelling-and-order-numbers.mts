// One-off data cleanup (Oct 2026):
//   1. "Joselito Compereso" → "Joselito Camperoso" in every technician column,
//      and his login linked on open jobs that carry the name but no account;
//   2. stray whitespace (spaces AND tabs — SQL TRIM() only removes spaces)
//      stripped from order numbers.
//
// Trimming a Sale List entry's order number fires its recurring-schedule
// triggers (sync_filter_change_schedule / sync_collection_schedule), which
// re-sync that entry's pending visits. Only the order number is meant to
// change, so this backs up those visits first and afterwards puts back
// anything else the triggers changed (dates, address, contact, added or
// removed occurrences).
//
// Dry run by default:  node scripts/cleanup-spelling-and-order-numbers.mts
// Apply (backup JSON written to your temp folder first):  … --apply
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")
const OLD_NAME = "Joselito Compereso"
const NEW_NAME = "Joselito Camperoso"

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
type Row = Record<string, unknown> & { id: string }

async function all(table: string, select = "*"): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(select).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data as unknown as Row[]))
    if (data.length < 1000) break
  }
  return out
}
const untrimmed = (v: unknown) => typeof v === "string" && v !== v.trim()
const hasOldName = (v: unknown) => typeof v === "string" && v.toLowerCase().includes(OLD_NAME.toLowerCase())
const fixName = (v: string) => v.replace(new RegExp(OLD_NAME, "gi"), NEW_NAME)

const TECH_COLUMNS: Record<string, string[]> = {
  schedule_jobs: ["technician", "technician_2"],
  filter_change_plans: ["serviceman", "serviceman_2"],
  collections: ["serviceman", "serviceman_2"],
  install_plans: ["serviceman", "serviceman_2"],
  repair_plans: ["th", "th_2"],
  customers: ["assigned_technician", "assigned_technician_2"],
}
const ORDER_COLUMNS: Record<string, string[]> = {
  sale_list_entries: ["order_number"],
  customers: ["order_number"],
  filter_change_plans: ["order_number"],
  install_plans: ["order_no"],
  repair_plans: ["order_no"],
  collections: ["order_no"],
  schedule_jobs: ["order_no"],
  stock_movements: ["reference_number"],
}

// ---- plan
const tables = [...new Set([...Object.keys(TECH_COLUMNS), ...Object.keys(ORDER_COLUMNS)])]
const rows: Record<string, Row[]> = {}
for (const t of tables) rows[t] = await all(t)
const patches: Record<string, Map<string, Record<string, unknown>>> = {}
const counts: Record<string, number> = {}
for (const t of tables) {
  patches[t] = new Map()
  for (const r of rows[t]) {
    const patch: Record<string, unknown> = {}
    for (const c of TECH_COLUMNS[t] ?? []) if (hasOldName(r[c])) patch[c] = fixName(r[c] as string)
    for (const c of ORDER_COLUMNS[t] ?? []) if (untrimmed(r[c])) patch[c] = (r[c] as string).trim()
    if (Object.keys(patch).length) {
      patches[t].set(r.id, patch)
      for (const c of Object.keys(patch)) counts[`${t}.${c}`] = (counts[`${t}.${c}`] ?? 0) + 1
    }
  }
}
// Joselito's login on open jobs that have his name but no account
const { data: acct } = await sb.from("profiles").select("id, name").ilike("name", NEW_NAME).maybeSingle()
const linkJobs = rows.schedule_jobs.filter(
  (j) => (j.status === "pending" || j.status === "pending_approval") && ((hasOldName(j.technician) || j.technician === NEW_NAME) && !j.technician_user_id)
)
// visits the Sale List triggers will re-sync
const entryIds = [...patches.sale_list_entries.keys()]
const guarded = { filter_change_plans: rows.filter_change_plans.filter((r) => entryIds.includes(r.sale_list_entry_id as string)), collections: rows.collections.filter((r) => entryIds.includes(r.sale_list_entry_id as string)) }

console.log(`${APPLY ? "APPLY" : "DRY RUN"}`)
console.log("  changes by column:", counts)
console.log(`  Joselito's account: ${acct ? acct.id : "NOT FOUND"} — open jobs to link: ${linkJobs.length} (${linkJobs.map((j) => j.order_no).join(", ")})`)
console.log(`  Sale List entries to trim: ${entryIds.length} → guarding ${guarded.filter_change_plans.length} Filter Change visit(s) and ${guarded.collections.length} collection(s) against trigger side effects`)
if (!APPLY) {
  console.log("\nNothing changed. Re-run with --apply.")
  process.exit(0)
}

// ---- apply
const backup = path.join(os.tmpdir(), `spelling-order-cleanup-${Date.now()}.json`)
fs.writeFileSync(
  backup,
  JSON.stringify({ changed: Object.fromEntries(tables.map((t) => [t, rows[t].filter((r) => patches[t].has(r.id))])), guarded, linkJobs }, null, 2)
)
console.log(`\nBackup written: ${backup}`)

const update = async (t: string, id: string, patch: Record<string, unknown>) => {
  const { error } = await sb.from(t).update(patch).eq("id", id)
  if (error) throw new Error(`${t} ${id}: ${error.message}`)
}
// 1. Sale List first (fires the schedule triggers)
for (const [id, patch] of patches.sale_list_entries) await update("sale_list_entries", id, patch)

// 2. put back anything the triggers changed besides the order number
const IGNORE = new Set(["order_number", "order_no", "updated_at", "updated_by"])
const repaired: string[] = []
for (const t of ["filter_change_plans", "collections"] as const) {
  const before = new Map(guarded[t].map((r) => [r.id, r]))
  const { data: afterRows, error } = await sb.from(t).select("*").in("sale_list_entry_id", entryIds)
  if (error) throw new Error(error.message)
  const after = new Map((afterRows as Row[]).map((r) => [r.id, r]))
  for (const [id, b] of before) {
    const a = after.get(id)
    const orderCol = t === "filter_change_plans" ? "order_number" : "order_no"
    if (!a) {
      // removed by the trigger — restore it (with the trimmed order number)
      const { error: insErr } = await sb.from(t).insert({ ...b, [orderCol]: String(b[orderCol] ?? "").trim() })
      if (insErr) throw new Error(`restore ${t} ${id}: ${insErr.message}`)
      repaired.push(`${t} ${id}: re-inserted`)
      continue
    }
    const fix: Record<string, unknown> = {}
    for (const k of Object.keys(b)) if (!IGNORE.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) fix[k] = b[k]
    if (Object.keys(fix).length) {
      await update(t, id, fix)
      repaired.push(`${t} ${id}: restored ${Object.keys(fix).join(", ")}`)
    }
    // its own order number is trimmed in step 3 if the trigger didn't already
    // (keeping any other fix queued for it, e.g. the technician name)
    const queued = { ...(patches[t].get(id) ?? {}) }
    if (untrimmed(a[orderCol])) queued[orderCol] = String(a[orderCol]).trim()
    else delete queued[orderCol]
    if (Object.keys(queued).length) patches[t].set(id, queued)
    else patches[t].delete(id)
  }
  for (const [id] of after) {
    if (!before.has(id)) {
      const { error: delErr } = await sb.from(t).delete().eq("id", id)
      if (delErr) throw new Error(`remove added ${t} ${id}: ${delErr.message}`)
      repaired.push(`${t} ${id}: removed (added by the trigger)`)
    }
  }
}
console.log(`trigger side effects undone: ${repaired.length}`, repaired.slice(0, 10))

// 3. everything else
let applied = 0
for (const t of tables) {
  if (t === "sale_list_entries") continue
  for (const [id, patch] of patches[t]) {
    await update(t, id, patch)
    applied++
  }
}
// 4. link Joselito's login
if (acct) for (const j of linkJobs) await update("schedule_jobs", j.id, { technician: NEW_NAME, technician_user_id: acct.id })
console.log(`Done: ${entryIds.length} Sale List entries + ${applied} other row(s) updated, ${acct ? linkJobs.length : 0} job(s) linked to ${NEW_NAME}.`)
