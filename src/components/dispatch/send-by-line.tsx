"use client"

import { useTranslation } from "@/lib/i18n/i18n-context"
import { businessToday, confirmationSendByDate } from "@/lib/dispatch-lead-time"
import { cn, formatDate } from "@/lib/utils"

// "Send by" for a Draft in an approval queue: the last day its confirmation
// email can go out with full notice (visit − CONFIRMATION_LEAD_DAYS) —
// highlighted when that's today, and as a warning once it has passed.
export function SendByLine({ visitDate, className }: { visitDate: string; className?: string }) {
  const { t } = useTranslation("dispatch")
  const sendBy = confirmationSendByDate(visitDate)
  const today = businessToday()
  const state = sendBy < today ? "overdue" : sendBy === today ? "today" : "upcoming"
  return (
    <p
      data-testid="send-by"
      data-state={state}
      className={cn(
        "text-xs",
        state === "overdue" ? "font-medium text-destructive" : state === "today" ? "font-medium text-warning" : "text-muted-foreground",
        className
      )}
    >
      {t(state === "overdue" ? "sendByOverdue" : state === "today" ? "sendByToday" : "sendBy", { date: formatDate(sendBy) })}
    </p>
  )
}
