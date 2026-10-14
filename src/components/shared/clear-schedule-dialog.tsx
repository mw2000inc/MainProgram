"use client"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useClearSchedules } from "@/lib/hooks/use-schedule"
import { useTranslation } from "@/lib/i18n/i18n-context"

// The "Clear Schedule" confirmation, shared by the Filter Change page and the
// Daily Report panel: removes the given records' schedule jobs (single or
// bulk) and leaves the records unscheduled — see clearSchedulesForRecords.
export function ClearScheduleDialog({
  table,
  recordIds,
  onOpenChange,
  onDone,
}: {
  table: "filter_change_plans" | "install_plans" | "repair_plans" | "collections"
  // Open while non-empty.
  recordIds: string[]
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const { t } = useTranslation("schedule")
  const clear = useClearSchedules()
  return (
    <ConfirmDialog
      open={recordIds.length > 0}
      onOpenChange={onOpenChange}
      title={recordIds.length > 1 ? t("clearScheduleTitleMany", { count: String(recordIds.length) }) : t("clearScheduleTitle")}
      description={t("clearScheduleConfirm")}
      confirmLabel={t("clearSchedule")}
      loading={clear.isPending}
      onConfirm={async () => {
        await clear.mutateAsync({ table, recordIds })
        onOpenChange(false)
        onDone?.()
      }}
    />
  )
}
