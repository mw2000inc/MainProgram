"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { actionLabel, entityTypeLabel, fieldLabel } from "@/lib/activity-log-config"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"

// Shared with deleted-record-dialog.tsx — both render raw column values
// straight from Postgres and need the exact same formatting. Left in
// English regardless of interface language (like every other raw-value
// formatter in this app) — this renders literal stored data, not UI chrome.
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "object") return JSON.stringify(value)
  const text = String(value)
  // Diffed values are raw column values straight from Postgres — dates come
  // back as ISO strings (date or timestamptz); render those the same way
  // the rest of the app does rather than showing the raw ISO text.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    try {
      return formatDate(text)
    } catch {
      return text
    }
  }
  return text
}

export function ActivityDetailDialog({
  entry,
  onOpenChange,
}: {
  entry: ActivityLogEntry | undefined
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("activity")
  const isUpdate = entry?.action === "update"
  const fieldKeys = entry ? Array.from(new Set([...Object.keys(entry.oldValues), ...Object.keys(entry.newValues)])) : []

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry?.userName}</DialogTitle>
          <DialogDescription>
            {entry && `${actionLabel(entry.action, t)} ${entityTypeLabel(entry.entityType, t)}`} ·{" "}
            {entry && formatDateTime(entry.createdAt)}
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="space-y-4 text-sm">
            {entry.description && (
              <div>
                <p className="text-xs text-muted-foreground">{t("record")}</p>
                <p className="font-medium">{entry.description}</p>
              </div>
            )}

            {fieldKeys.length === 0 && <p className="text-muted-foreground">{t("noFieldLevelDetails")}</p>}

            {isUpdate ? (
              <div className="space-y-3">
                {fieldKeys.map((key) => (
                  <div key={key} className="grid grid-cols-2 gap-3 rounded-md border p-2.5">
                    <div>
                      <p className="text-xs text-muted-foreground">{fieldLabel(key, t)} — {t("before")}</p>
                      <p>{formatValue(entry.oldValues[key])}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{fieldLabel(key, t)} — {t("after")}</p>
                      <p>{formatValue(entry.newValues[key])}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              fieldKeys.length > 0 && (
                <div className="space-y-1.5 rounded-md border p-2.5">
                  {fieldKeys.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{fieldLabel(key, t)}</span>
                      <span>{formatValue(entry.action === "delete" ? entry.oldValues[key] : entry.newValues[key])}</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
