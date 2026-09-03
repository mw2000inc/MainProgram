"use client"

import { AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { entityTypeLabel, fieldLabel } from "@/lib/activity-log-config"
import { formatValue } from "@/components/activity/activity-detail-dialog"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDateTime } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"

// Best-effort "common field" extraction from a deleted row's own snapshot
// (log.oldValues) — different tables use different column names for
// conceptually the same thing (customers.full_name vs sale_list_entries.
// order_number as the "name", customers.address vs nothing at all on a
// schedule job), so each label tries a short list of real column names in
// priority order and simply doesn't render if none of them are present,
// rather than guessing or showing a misleading blank field. `labelKey`
// points into activity.json's curated* keys rather than a literal string.
const CURATED_FIELDS: { labelKey: string; keys: string[] }[] = [
  { labelKey: "curatedName", keys: ["company_name", "full_name", "name", "account_name", "member_account", "order_no", "order_number", "title", "system_code", "label"] },
  { labelKey: "curatedEmail", keys: ["email", "email2"] },
  { labelKey: "curatedPhone", keys: ["contact_number", "contact_number2"] },
  { labelKey: "curatedAddress", keys: ["address", "address2"] },
  { labelKey: "curatedContractTerm", keys: ["c_t"] },
]

// Internal bookkeeping columns already shown elsewhere (id, the record's
// own created_at is folded into "Date Created" above, audit stamps) —
// excluded from the generic "everything else" list below so it doesn't
// just repeat the curated section or show noise nobody asked to see.
const HIDDEN_KEYS = new Set(["id", "created_at", "updated_at", "created_by", "updated_by"])

export function DeletedRecordDialog({
  entry,
  onOpenChange,
}: {
  entry: ActivityLogEntry | undefined
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("activity")
  const snapshot = entry?.oldValues ?? {}
  const snapshotKeys = Object.keys(snapshot)

  const curated = CURATED_FIELDS.map(({ labelKey, keys }) => {
    const key = keys.find((k) => snapshot[k] !== undefined && snapshot[k] !== null && snapshot[k] !== "")
    return key ? { labelKey, value: formatValue(snapshot[key]) } : null
  }).filter((f): f is { labelKey: string; value: string } => f !== null)

  const curatedKeys = new Set(CURATED_FIELDS.flatMap((f) => f.keys))
  const otherKeys = snapshotKeys.filter((k) => !curatedKeys.has(k) && !HIDDEN_KEYS.has(k))

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deletedRecordTitle", { entityType: entityTypeLabel(entry?.entityType, t) })}</DialogTitle>
          <DialogDescription>{entry?.description || t("noDescriptionRecorded")}</DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-2 rounded-md border bg-warning/10 text-warning border-warning/20 p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                {t("deletedNotice", {
                  date: formatDateTime(entry.createdAt),
                  user: entry.userName,
                })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("entityTypeLabel")}</p>
                <p className="font-medium">{entityTypeLabel(entry.entityType, t)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("dateCreated")}</p>
                <p className="font-medium">{snapshot.created_at ? formatValue(snapshot.created_at) : "—"}</p>
              </div>
              {curated.map((f) => (
                <div key={f.labelKey}>
                  <p className="text-xs text-muted-foreground">{t(f.labelKey)}</p>
                  <p className="font-medium">{f.value}</p>
                </div>
              ))}
              <div>
                <p className="text-xs text-muted-foreground">{t("dateDeleted")}</p>
                <p className="font-medium">{formatDateTime(entry.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("performingAdmin")}</p>
                <p className="font-medium">{entry.userName}</p>
              </div>
            </div>

            {otherKeys.length > 0 && (
              <div className="space-y-1.5 rounded-md border p-2.5">
                <p className="text-xs text-muted-foreground mb-1">{t("fullSnapshot")}</p>
                {otherKeys.map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{fieldLabel(key, t)}</span>
                    <span className="text-right">{formatValue(snapshot[key])}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
