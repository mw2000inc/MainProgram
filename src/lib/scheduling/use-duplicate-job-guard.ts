"use client"

import * as React from "react"
import { findOpenJobForOrder } from "@/lib/api/schedule"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { ScheduleJobType } from "@/lib/types"
import { formatDate } from "@/lib/utils"

// The warning for a job that would duplicate the order's open job of the same
// type (findOpenJobForOrder) — "A Filter Change draft already exists for
// Order No. 001-0250 on Oct 15, 2026 …" — or undefined when there's none.
export function useDuplicateJobGuard() {
  const { t } = useTranslation("schedule")
  return React.useCallback(
    async (jobType: ScheduleJobType, orderNo: string | undefined, excludeJobId?: string): Promise<string | undefined> => {
      const existing = await findOpenJobForOrder(jobType, orderNo, excludeJobId)
      if (!existing) return undefined
      return t("duplicateOpenJob", {
        type: t(jobType),
        state: t(existing.status === "pending_approval" ? "duplicateStateDraft" : "duplicateStateJob"),
        orderNo: (orderNo ?? "").trim(),
        date: formatDate(existing.scheduledDate),
      })
    },
    [t]
  )
}
