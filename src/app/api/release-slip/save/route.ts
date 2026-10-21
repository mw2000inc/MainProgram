import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { saveReleaseSlip, type SlipSaveRow } from "@/lib/scheduling/release-slip-save"

// Release Slip → Daily Report: saves the slip's rows as completed visits and
// queues their items (see release-slip-save.ts). Admins save any
// technician's slip; a technician only ever their own (the technician sent
// is ignored for them).
const JOB_TYPES = new Set(["filter_change", "repair", "installation", "collection"])

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  const isAdmin = profile?.role === "admin"
  if (!isAdmin && profile?.role !== "technician") return NextResponse.json({ error: "Not allowed" }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { date?: string; technicianUserId?: string; rows?: SlipSaveRow[] } | null
  if (!body?.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return NextResponse.json({ error: "date (yyyy-MM-dd) is required" }, { status: 400 })
  const technicianUserId = isAdmin ? body.technicianUserId : caller.id
  if (!technicianUserId) return NextResponse.json({ error: "Pick a technician first" }, { status: 400 })
  const rows = (Array.isArray(body.rows) ? body.rows : []).filter(
    (r): r is SlipSaveRow => !!r && JOB_TYPES.has(r.jobType) && typeof r.orderNo === "string" && Array.isArray(r.items)
  )
  if (rows.length === 0) return NextResponse.json({ error: "Nothing to save" }, { status: 400 })

  try {
    const result = await saveReleaseSlip(createAdminClient(), { date: body.date, technicianUserId, actorUserId: caller.id, rows, canChangeApproved: isAdmin })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Save failed" }, { status: 500 })
  }
}
