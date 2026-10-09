import { supabase } from "@/lib/supabase/client"
import { wrapSupabaseError } from "@/lib/supabase/errors"

export interface ReleaseSlipMovement {
  sku: string
  label: string
  qtyOut: number
  qtyIn: number
  // 'pending' = awaiting inventory approval (printed with an asterisk).
  status: string
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
}

export interface ReleaseSlipData {
  technicianName: string
  jobs: ReleaseSlipJob[]
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
    movements: { sku: string; label: string; qty_out: number; qty_in: number; status: string }[]
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
  return {
    technicianName: raw.technician_name ?? "",
    jobs: (raw.jobs ?? []).map((j) => ({
      jobId: j.job_id,
      orderNo: j.order_no,
      accountName: j.account_name,
      jobType: j.job_type,
      status: j.status,
      technician: j.technician,
      technician2: j.technician_2,
      movements: (j.movements ?? []).map((m) => ({ sku: m.sku, label: m.label, qtyOut: Number(m.qty_out) || 0, qtyIn: Number(m.qty_in) || 0, status: m.status })),
    })),
  }
}
