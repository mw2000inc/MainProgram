"use client"

import * as React from "react"
import { CalendarDays, CheckCircle2, Clock, RotateCcw, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type BadgeTone } from "@/components/shared/status-badge"
import { Logo } from "@/components/shared/logo"
import { useDispatchConfirmationDetails, useRespondToDispatchConfirmation } from "@/lib/hooks/use-dispatch-confirmation"
import { useTranslation, usePreAuthLocale } from "@/lib/i18n/i18n-context"
import { formatDate, todayIso } from "@/lib/utils"
import type { DispatchStatus } from "@/lib/types"

const MODULE_KEYS: Record<string, string> = {
  filter_change_plans: "filterChangeModule",
  install_plans: "installationModule",
  collections: "collectionModule",
  repair_plans: "repairModule",
}

const STATUS_TONE: Record<DispatchStatus, BadgeTone> = {
  Draft: "neutral",
  "Pending Customer Confirmation": "warning",
  Confirmed: "success",
  "Reschedule Requested": "danger",
}

const STATUS_KEYS: Record<DispatchStatus, string> = {
  Draft: "draft",
  "Pending Customer Confirmation": "pendingCustomerConfirmation",
  Confirmed: "confirmed",
  "Reschedule Requested": "rescheduleRequested",
}

// Public, no-login page a customer lands on from their SMS/Email
// confirmation link (see approve_dispatch_item() in the
// dispatch_confirmation_workflow migration). All data access goes through
// the security-definer get_dispatch_confirmation_details/
// respond_to_dispatch_confirmation RPCs — same "narrow RPC instead of
// loosening RLS" pattern as the customer portal's get_portal_profile.
export function DispatchConfirmationView({ token }: { token: string }) {
  const { t } = useTranslation("confirm")
  const { t: tDispatch } = useTranslation("dispatch")
  const { locale, setLocale } = usePreAuthLocale()
  const { data: details, isPending, refetch } = useDispatchConfirmationDetails(token)
  const respond = useRespondToDispatchConfirmation()
  const [respondedTo, setRespondedTo] = React.useState<DispatchStatus | null>(null)
  // Clicking "Request a different date" reveals this picker instead of
  // firing the reschedule action immediately — the customer's own
  // proposed date/time gets sent along with it now, for an admin to
  // review and accept (see the Pending Dispatch Approval queue's
  // Reschedule Requests section), rather than a pure decline signal.
  const [showReschedulePicker, setShowReschedulePicker] = React.useState(false)
  const [requestedDate, setRequestedDate] = React.useState("")
  const [requestedTime, setRequestedTime] = React.useState("")
  // Kept locally rather than round-tripped through the server response —
  // the customer just typed these in, no need to ask the RPC to echo them
  // back for the "got it" screen below to show.
  const [submittedRequest, setSubmittedRequest] = React.useState<{ date: string; time: string } | null>(null)

  async function handleConfirm() {
    const result = await respond.mutateAsync({ token, action: "confirm" })
    if (result.ok && result.status) {
      setRespondedTo(result.status)
    } else {
      // Token expired/already used between page load and click — re-fetch
      // so the "already resolved / invalid" state below reflects reality.
      refetch()
    }
  }

  async function handleSubmitReschedule() {
    if (!requestedDate) return
    const result = await respond.mutateAsync({ token, action: "reschedule", requestedDate, requestedTime: requestedTime || undefined })
    if (result.ok && result.status) {
      setSubmittedRequest({ date: requestedDate, time: requestedTime })
      setRespondedTo(result.status)
    } else {
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
            <p className="text-lg font-medium">{t("linkInvalidTitle")}</p>
            <p className="text-sm text-muted-foreground max-w-sm">{t("linkInvalidDescription")}</p>
          </CardContent>
        </Card>
      )
    }

    const effectiveStatus = respondedTo ?? details.status
    const moduleKey = MODULE_KEYS[details.entityType]
    const moduleLabel = moduleKey ? tDispatch(moduleKey) : details.entityType

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
            <p className="text-lg font-medium">{isConfirmed ? t("confirmedTitle") : t("rescheduleTitle")}</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {isConfirmed
                ? t("confirmedDescription", { module: moduleLabel.toLowerCase(), date: formatDate(details.scheduledDate) })
                : submittedRequest
                  ? t("rescheduleSubmittedDescription", {
                      date: formatDate(submittedRequest.date),
                      time: submittedRequest.time ? t("rescheduleAtTime", { time: submittedRequest.time }) : "",
                    })
                  : t("rescheduleGenericDescription")}
            </p>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" /> {t("visitTitle", { module: moduleLabel })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-md border bg-muted/40 p-4">
            <div>
              <p className="font-medium">{details.label}</p>
              <p className="text-sm text-muted-foreground">{t("scheduled", { date: formatDate(details.scheduledDate) })}</p>
            </div>
            <StatusBadge tone={STATUS_TONE[effectiveStatus]} label={tDispatch(STATUS_KEYS[effectiveStatus])} />
          </div>
          <p className="text-sm text-muted-foreground">{t("pleaseLetUsKnow")}</p>
          {!showReschedulePicker ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <Button className="flex-1 gap-1.5" disabled={respond.isPending} onClick={handleConfirm}>
                <CheckCircle2 className="h-4 w-4" /> {t("confirmThisDate")}
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-1.5"
                disabled={respond.isPending}
                onClick={() => setShowReschedulePicker(true)}
              >
                <Clock className="h-4 w-4" /> {t("requestDifferentDate")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm font-medium">{t("whatDateWouldWork")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("date")}</Label>
                  <Input type="date" min={todayIso()} value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("timeOptional")}</Label>
                  <Input type="time" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button className="flex-1 gap-1.5" disabled={!requestedDate || respond.isPending} onClick={handleSubmitReschedule}>
                  <Clock className="h-4 w-4" /> {t("submitRequest")}
                </Button>
                <Button variant="outline" className="flex-1" disabled={respond.isPending} onClick={() => setShowReschedulePicker(false)}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    )
  })()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex items-center gap-2">
            <Logo className="h-9 w-9 shrink-0" />
            <div className="leading-tight">
              <p className="font-semibold text-sm">{t("headerTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("headerSubtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              className={locale === "en" ? "font-semibold underline" : "text-muted-foreground"}
              onClick={() => setLocale("en")}
            >
              English
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              className={locale === "ko" ? "font-semibold underline" : "text-muted-foreground"}
              onClick={() => setLocale("ko")}
            >
              한국어
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">{content}</main>
    </div>
  )
}
