import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Remove an order from the Release Slip (its × on the slip page), or put it
// back ("Restore"). Admins on any slip; a technician only for their own jobs.
//
// Remove: the job is hidden from the slip (schedule_jobs.slip_hidden,
// 20261122000000) and the order's PENDING items the slip showed are taken out
// of the Inventory List — the job's own, its Filter Change / Installation
// record's, its repair's part lines and Part No lines. A repair's Part No is
// cleared too when its lines are removed, else the Part No queue would add
// them back on the repair's next save. Approved items stay (stock already
// moved). The visit itself is not cancelled or changed otherwise.
// Restore: the job shows on the slip again (removed items are not re-added).
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  const isAdmin = profile?.role === "admin"
  if (!isAdmin && profile?.role !== "technician") return NextResponse.json({ error: "Not allowed" }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { jobIds?: unknown; restore?: boolean } | null
  const jobIds = Array.isArray(body?.jobIds) ? body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0) : []
  if (jobIds.length === 0) return NextResponse.json({ error: "jobIds (non-empty array) is required" }, { status: 400 })

  const db = createAdminClient()
  const { data: jobs, error: jobsError } = await db.from("schedule_jobs").select("id, technician_user_id, technician_2_user_id").in("id", jobIds)
  if (jobsError) return NextResponse.json({ error: jobsError.message }, { status: 500 })
  const found = (jobs ?? []) as { id: string; technician_user_id: string | null; technician_2_user_id: string | null }[]
  if (found.length !== jobIds.length) return NextResponse.json({ error: "Job not found" }, { status: 404 })
  if (!isAdmin && found.some((j) => j.technician_user_id !== user.id && j.technician_2_user_id !== user.id)) {
    return NextResponse.json({ error: "You can only remove your own orders" }, { status: 403 })
  }

  try {
    let removed = 0
    if (!body?.restore) {
      const ors = [`schedule_job_id.in.(${jobIds.join(",")})`]
      const { data: fcs } = await db.from("filter_change_plans").select("id").in("schedule_job_id", jobIds)
      const fcIds = ((fcs ?? []) as { id: string }[]).map((r) => r.id)
      if (fcIds.length) ors.push(`filter_change_plan_id.in.(${fcIds.join(",")})`)
      const { data: ins } = await db.from("install_plans").select("id").in("schedule_job_id", jobIds)
      const insIds = ((ins ?? []) as { id: string }[]).map((r) => r.id)
      if (insIds.length) ors.push(`install_plan_id.in.(${insIds.join(",")})`)
      const { data: reps } = await db.from("repair_plans").select("id, part_no").in("schedule_job_id", jobIds)
      const repairs = (reps ?? []) as { id: string; part_no: string | null }[]
      if (repairs.length) {
        const { data: parts } = await db.from("repair_plan_parts").select("id").in("repair_plan_id", repairs.map((r) => r.id))
        const partIds = ((parts ?? []) as { id: string }[]).map((p) => p.id)
        if (partIds.length) ors.push(`repair_plan_part_id.in.(${partIds.join(",")})`)
      }
      // Pending items the slip shows for these orders (a repair's Repair Unit
      // line isn't shown on the slip, so it stays).
      const { data: pending, error } = await db.from("stock_movements").select("id, reason").or(ors.join(",")).eq("status", "pending").neq("reason", "Repair Unit")
      if (error) throw error
      const ids = ((pending ?? []) as { id: string }[]).map((m) => m.id)
      // A repair's Part No lines (linked to the repair only).
      const repairIds = repairs.filter((r) => (r.part_no ?? "").trim()).map((r) => r.id)
      if (repairIds.length) {
        const { data: partNoLines, error: pnError } = await db
          .from("stock_movements")
          .select("id, repair_plan_id")
          .in("repair_plan_id", repairIds)
          .is("repair_plan_part_id", null)
          .eq("reason", "Repair")
          .eq("status", "pending")
        if (pnError) throw pnError
        const lines = (partNoLines ?? []) as { id: string; repair_plan_id: string }[]
        for (const l of lines) if (!ids.includes(l.id)) ids.push(l.id)
        // Its Part No cleared, so the queue doesn't add them back.
        const clear = [...new Set(lines.map((l) => l.repair_plan_id))]
        if (clear.length) {
          const { error: clearError } = await db.from("repair_plans").update({ part_no: null, updated_by: user.id }).in("id", clear)
          if (clearError) throw clearError
        }
      }
      if (ids.length) {
        const { error: delError } = await db.from("stock_movements").delete().in("id", ids).eq("status", "pending")
        if (delError) throw delError
      }
      removed = ids.length
    }
    const { error: hideError } = await db.from("schedule_jobs").update({ slip_hidden: !body?.restore, updated_by: user.id }).in("id", jobIds)
    if (hideError) throw hideError
    return NextResponse.json({ removed })
  } catch (e) {
    return NextResponse.json({ error: (e as { message?: string } | null)?.message || "Couldn't remove the order" }, { status: 500 })
  }
}
