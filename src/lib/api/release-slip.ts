import { supabase } from "@/lib/supabase/client"
import { wrapSupabaseError } from "@/lib/supabase/errors"

export interface ReleaseSlipMovement {
  sku: string
  label: string
  qtyOut: number
  qtyIn: number
  // 'pending' = awaiting inventory approval (printed with an asterisk).
  status: string
  // Manual rows added on the slip page (not from the database): printed in
  // the Notes column. An errand row is a task note — its item is printed but
  // left out of the Summary totals.
  note?: string
  errand?: boolean
  // Admin edits on the slip page (applySlipEdits): the IN column's item when
  // it differs from the OUT one, and a line kept even while it's empty.
  inSku?: string
  edited?: boolean
  // What the item is for ("Parts", "Filter", …), picked on the slip and saved
  // with it (stock_movements.purpose, 20261119000000).
  purpose?: string
  // The job type box ticked for this item on the slip ('F' | 'R' | 'S' | 'O');
  // unset = the job's own type (stock_movements.slip_type, 20261120000000).
  slipType?: string
}

export interface ReleaseSlipJob {
  jobId: string
  orderNo: string
  accountName: string
  jobType: string
  status: string
  technician: string
  technician2: string
  movements: ReleaseSlipMovement[]
  // Set on the slip page, not by the database: the money to collect on this
  // visit ("To Collect: ₱8,500.00 (Cash)" — see release-slip-collect.ts),
  // printed in the job's first Notes cell.
  jobNote?: string
  // A blank order row an admin added on the slip page ("+ Add Order No."):
  // its Order No. and type boxes are editable too. Never saved.
  added?: boolean
}

export interface ReleaseSlipData {
  technicianName: string
  jobs: ReleaseSlipJob[]
  // Orders removed from the slip (its ×; schedule_jobs.slip_hidden) — left
  // out of jobs, listed so they can be restored.
  hiddenJobs: { jobId: string; orderNo: string }[]
}

type Raw = {
  technician_name: string | null
  jobs: {
    job_id: string
    order_no: string
    account_name: string
    job_type: string
    status: string
    technician: string
    technician_2: string
    movements: { sku: string; label: string; qty_out: number; qty_in: number; status: string; purpose?: string; slip_type?: string }[]
  }[]
}

// One technician's Release Slip for a day, from the get_release_slip function
// (20261029000000): a technician always gets their own jobs; an admin passes
// the technician to show. Completed jobs, plus pending ones when asked.
export async function fetchReleaseSlip(date: string, technicianUserId: string | undefined, includePending: boolean): Promise<ReleaseSlipData> {
  const { data, error } = await supabase.rpc("get_release_slip", {
    p_date: date,
    p_technician_user_id: technicianUserId ?? null,
    p_include_pending: includePending,
  })
  if (error) throw wrapSupabaseError(error)
  const raw = data as Raw
  // Orders removed from the slip. Before the 20261122000000 migration the
  // column doesn't exist: nothing is hidden.
  const ids = (raw.jobs ?? []).map((j) => j.job_id)
  const hidden = new Set<string>()
  if (ids.length) {
    const { data: rows, error: hiddenError } = await supabase.from("schedule_jobs").select("id").in("id", ids).eq("slip_hidden", true)
    if (!hiddenError) for (const r of (rows ?? []) as { id: string }[]) hidden.add(r.id)
  }
  return {
    technicianName: raw.technician_name ?? "",
    hiddenJobs: (raw.jobs ?? []).filter((j) => hidden.has(j.job_id)).map((j) => ({ jobId: j.job_id, orderNo: j.order_no })),
    jobs: (raw.jobs ?? []).filter((j) => !hidden.has(j.job_id)).map((j) => ({
      jobId: j.job_id,
      orderNo: j.order_no,
      accountName: j.account_name,
      jobType: j.job_type,
      status: j.status,
      technician: j.technician,
      technician2: j.technician_2,
      movements: (j.movements ?? []).map((m) => ({ sku: m.sku, label: m.label, qtyOut: Number(m.qty_out) || 0, qtyIn: Number(m.qty_in) || 0, status: m.status, purpose: m.purpose || undefined, slipType: m.slip_type || undefined })),
    })),
  }
}
