import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Best-effort webhook stub for an inbound SMS reply to a dispatch
// confirmation text (see the dispatch_confirmation_workflow migration and
// its respond_to_dispatch_confirmation_by_contact() follow-up). Outbound
// SMS goes through textbee now (see dispatch-notifications-server.ts), but
// this inbound side is still just a stub — textbee's own inbound-webhook
// payload shape (if it has one at all; it sends through an admin's own
// Android phone via a companion app, not a traditional two-way gateway)
// hasn't been looked up and wired here yet. Written provider-agnostic in
// the meantime, since the closest analogues shape their payloads
// differently:
//   - Twilio posts form-urlencoded fields named "From" and "Body".
//   - Many others post JSON with different field names again (e.g.
//     "sender"/"message", "msisdn"/"text").
// To stay useful across that uncertainty, this reads a handful of common
// field name variants from either a form-urlencoded or JSON body rather
// than betting on one provider's exact shape — replace this parsing block
// with textbee's real documented payload once it's actually looked up, and
// add its signature/HMAC verification (or equivalent) before trusting the
// body at all. Right now ANY caller who finds this URL could flip a
// customer's dispatch_status, since there's no secret shared with a
// not-yet-verified provider to validate against.
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  let from: string | undefined
  let body: string | undefined

  if (contentType.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>
    from = firstString(json, ["From", "from", "sender", "msisdn"])
    body = firstString(json, ["Body", "body", "message", "text"])
  } else {
    const form = await request.formData().catch(() => null)
    if (form) {
      from = firstString(Object.fromEntries(form), ["From", "from", "sender", "msisdn"])
      body = firstString(Object.fromEntries(form), ["Body", "body", "message", "text"])
    }
  }

  if (!from || !body) {
    return NextResponse.json({ error: "Could not read sender/message from this payload — see the comment in this route for why." }, { status: 400 })
  }

  const action = classifyReply(body)
  if (!action) {
    // Not a recognizable yes/no reply — nothing to update, but still 200 so
    // the provider doesn't treat this as a failed delivery and retry.
    return NextResponse.json({ handled: false, reason: "Reply did not match a known confirm/reschedule keyword" })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("respond_to_dispatch_confirmation_by_contact", {
    p_contact: normalizeContact(from),
    p_action: action,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const row = (data as { out_ok: boolean; out_status: string | null; out_entity_type: string | null; out_label: string | null }[])?.[0]
  if (!row?.out_ok) {
    return NextResponse.json({ handled: false, reason: "No pending confirmation found for this sender" })
  }
  return NextResponse.json({ handled: true, status: row.out_status, entityType: row.out_entity_type, label: row.out_label })
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

// Deliberately simple keyword matching, not NLP — a real deployment should
// tune this against what customers actually send back once real replies
// start coming in.
function classifyReply(body: string): "confirm" | "reschedule" | null {
  const normalized = body.trim().toLowerCase()
  if (["yes", "y", "confirm", "1", "ok", "okay"].includes(normalized)) return "confirm"
  if (["no", "n", "reschedule", "2", "resched"].includes(normalized)) return "reschedule"
  return null
}

// Phone numbers arrive from providers in varying formats (+63917..., 0917...,
// with/without spaces or dashes) that likely won't byte-for-byte match
// whatever an admin typed into the approval queue's contact field. Strips
// everything but digits and a leading "+" as a minimal best-effort
// normalization — replace with whatever matching the real provider's number
// format actually needs.
function normalizeContact(raw: string): string {
  return raw.replace(/(?!^\+)[^\d]/g, "")
}
