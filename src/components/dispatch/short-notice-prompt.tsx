"use client"

import * as React from "react"
import { CalendarClock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { CONFIRMATION_LEAD_DAYS } from "@/lib/dispatch-lead-time"
import { formatDate } from "@/lib/utils"

// The admin's choice when approving a Draft whose visit is closer than
// CONFIRMATION_LEAD_DAYS (the confirmation email would arrive late).
export type ShortNoticeChoice = "move" | "skip"

interface Request {
  label?: string
  scheduledDate: string
  earliestDate: string
  resolve: (choice: ShortNoticeChoice) => void
}

// One prompt for the whole app (mounted once in Providers), opened by
// askShortNotice() from the approval mutation — so every approval screen
// (Pending Dispatch Approval, Pending Approvals, the approval dialog, bulk
// "Approve all") gets it without its own UI. Requests queue up, and "use
// this choice for the rest" answers the following ones in the same batch.
const EMPTY: Request[] = []
let queue: Request[] = EMPTY
let remembered: { choice: ShortNoticeChoice; until: number } | undefined
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

// A remembered choice lasts while a bulk approval keeps using it: each use
// renews it for REMEMBER_MS, so it lapses shortly after the batch ends.
const REMEMBER_MS = 30_000

export function askShortNotice(input: Omit<Request, "resolve">): Promise<ShortNoticeChoice> {
  if (remembered && remembered.until > Date.now()) {
    remembered.until = Date.now() + REMEMBER_MS
    return Promise.resolve(remembered.choice)
  }
  return new Promise((resolve) => {
    queue = [...queue, { ...input, resolve }]
    notify()
  })
}

export function ShortNoticePromptHost() {
  const { t } = useTranslation("dispatch")
  const pending = React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => queue,
    () => EMPTY
  )
  const current = pending[0]
  const [applyToRest, setApplyToRest] = React.useState(false)

  const answer = (choice: ShortNoticeChoice) => {
    if (!current) return
    if (applyToRest) remembered = { choice, until: Date.now() + REMEMBER_MS }
    const rest = queue.slice(1)
    queue = EMPTY
    current.resolve(choice)
    if (applyToRest) rest.forEach((r) => r.resolve(choice))
    else queue = rest.length ? rest : EMPTY
    setApplyToRest(false)
    notify()
  }

  return (
    <Dialog open={!!current} onOpenChange={(open) => !open && answer("skip")}>
      <DialogContent className="sm:max-w-md" data-testid="short-notice-prompt">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-warning" /> {t("shortNoticeTitle")}
          </DialogTitle>
          <DialogDescription>
            {current &&
              t("shortNoticeBody", {
                label: current.label ?? "",
                date: formatDate(current.scheduledDate),
                days: CONFIRMATION_LEAD_DAYS,
                earliest: formatDate(current.earliestDate),
              })}
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={applyToRest} onCheckedChange={(v) => setApplyToRest(v === true)} data-testid="short-notice-apply-rest" />
          {t("shortNoticeApplyToRest")}
        </label>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => answer("skip")} data-testid="short-notice-skip">
            {t("shortNoticeSkip")}
          </Button>
          <Button onClick={() => answer("move")} data-testid="short-notice-move">
            {current ? t("shortNoticeMove", { date: formatDate(current.earliestDate) }) : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
