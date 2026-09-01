"use client"

import { useParams } from "next/navigation"
import { DispatchConfirmationView } from "@/components/confirm/dispatch-confirmation-view"

// Public, no-login route linked from a customer's SMS/Email dispatch
// confirmation message (see approve_dispatch_item() in the
// dispatch_confirmation_workflow migration). The token is a random uuid —
// all lookups/updates go through security-definer RPCs scoped to exactly
// this one token, so no other customer's record is ever reachable.
export default function DispatchConfirmationPage() {
  const params = useParams<{ token: string }>()
  return <DispatchConfirmationView token={params.token} />
}
