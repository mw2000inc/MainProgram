"use client"

import * as React from "react"
import { CalendarDays, CheckCircle2, Clock, RotateCcw, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type BadgeTone } from "@/components/shared/status-badge"
import { Logo } from "@/components/shared/logo"
import { useDispatchConfirmationDetails, useRespondToDispatchConfirmation } from "@/lib/hooks/use-dispatch-confirmation"
import { formatDate } from "@/lib/utils"
import type { DispatchStatus } from "@/lib/types"

const MODULE_LABELS: Record<string, string> = {
  filter_change_plans: "Filter Change",
  install_plans: "Installation",
  collections: "Collection",
  repair_plans: "Repair",
}

const STATUS_TONE: Record<DispatchStatus, BadgeTone> = {
  Draft: "neutral",
  "Pending Customer Confirmation": "warning",
  Confirmed: "success",
  "Reschedule Requested": "danger",
}

// Public, no-login page a customer lands on from their SMS/Email
// confirmation link (see approve_dispatch_item() in the
// dispatch_confirmation_workflow migration). All data access goes through
// the security-definer get_dispatch_confirmation_details/
// respond_to_dispatch_confirmation RPCs — same "narrow RPC instead of
// loosening RLS" pattern as the customer portal's get_portal_profile.
export function DispatchConfirmationView({ token }: { token: string }) {
  const { data: details, isPending, refetch } = useDispatchConfirmationDetails(token)
  const respond = useRespondToDispatchConfirmation()
  const [respondedTo, setRespondedTo] = React.useState<DispatchStatus | null>(null)

  async function handleRespond(action: "confirm" | "reschedule") {
    const result = await respond.mutateAsync({ token, action })
    if (result.ok && result.status) {
      setRespondedTo(result.status)
    } else {
      // Token expired/already used between page load and click — re-fetch
      // so the "already resolved / invalid" state below reflects reality.
      refetch()
    }
  }

  const content = (() => {
    if (isPending) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )
    }

    if (!details || !details.valid) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <XCircle className="h-8 w-8 text-muted-foreground" />
            <p className="text-lg font-medium">This link is no longer valid</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              It may have expired, already been used, or the schedule item may have changed since it was sent.
              Please contact us if you still need to confirm or reschedule a visit.
            </p>
          </CardContent>
        </Card>
      )
    }

    const effectiveStatus = respondedTo ?? details.status
    const moduleLabel = MODULE_LABELS[details.entityType] ?? details.entityType

    if (effectiveStatus === "Confirmed" || effectiveStatus === "Reschedule Requested") {
      const isConfirmed = effectiveStatus === "Confirmed"
      return (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            {isConfirmed ? (
              <CheckCircle2 className="h-8 w-8 text-success" />
            ) : (
              <RotateCcw className="h-8 w-8 text-warning" />
            )}
            <p className="text-lg font-medium">
              {isConfirmed ? "Thanks — your visit is confirmed!" : "Got it — we'll be in touch to reschedule"}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {isConfirmed
                ? `Your ${moduleLabel.toLowerCase()} visit on ${formatDate(details.scheduledDate)} is locked in.`
                : "We've let our team know this date no longer works. They'll reach out with a new one shortly."}
            </p>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" /> {moduleLabel} Visit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-md border bg-muted/40 p-4">
            <div>
              <p className="font-medium">{details.label}</p>
              <p className="text-sm text-muted-foreground">Scheduled {formatDate(details.scheduledDate)}</p>
            </div>
            <StatusBadge tone={STATUS_TONE[effectiveStatus]} label={effectiveStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            Please let us know if this date still works for you.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button className="flex-1 gap-1.5" disabled={respond.isPending} onClick={() => handleRespond("confirm")}>
              <CheckCircle2 className="h-4 w-4" /> Confirm this date
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-1.5"
              disabled={respond.isPending}
              onClick={() => handleRespond("reschedule")}
            >
              <Clock className="h-4 w-4" /> Request a different date
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  })()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-lg mx-auto flex items-center gap-2 px-4 py-4">
          <Logo className="h-9 w-9 shrink-0" />
          <div className="leading-tight">
            <p className="font-semibold text-sm">MW2000</p>
            <p className="text-xs text-muted-foreground">Schedule Confirmation</p>
          </div>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">{content}</main>
    </div>
  )
}
