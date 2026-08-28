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
import { formatDateTime } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"

// Best-effort "common field" extraction from a deleted row's own snapshot
// (log.oldValues) — different tables use different column names for
// conceptually the same thing (customers.full_name vs sale_list_entries.
// order_number as the "name", customers.address vs nothing at all on a
// schedule job), so each label tries a short list of real column names in
// priority order and simply doesn't render if none of them are present,
// rather than guessing or showing a misleading blank field.
const CURATED_FIELDS: { label: string; keys: string[] }[] = [
  { label: "Name", keys: ["company_name", "full_name", "name", "account_name", "member_account", "order_no", "order_number", "title", "system_code", "label"] },
  { label: "Email", keys: ["email", "email2"] },
  { label: "Phone", keys: ["contact_number", "contact_number2"] },
  { label: "Address", keys: ["address", "address2"] },
  { label: "Contract Term (C/T)", keys: ["c_t"] },
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
  const snapshot = entry?.oldValues ?? {}
  const snapshotKeys = Object.keys(snapshot)

  const curated = CURATED_FIELDS.map(({ label, keys }) => {
    const key = keys.find((k) => snapshot[k] !== undefined && snapshot[k] !== null && snapshot[k] !== "")
    return key ? { label, value: formatValue(snapshot[key]) } : null
  }).filter((f): f is { label: string; value: string } => f !== null)

  const curatedKeys = new Set(CURATED_FIELDS.flatMap((f) => f.keys))
  const otherKeys = snapshotKeys.filter((k) => !curatedKeys.has(k) && !HIDDEN_KEYS.has(k))

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entityTypeLabel(entry?.entityType)} — Deleted Record</DialogTitle>
          <DialogDescription>{entry?.description || "No description recorded"}</DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-2 rounded-md border bg-warning/10 text-warning border-warning/20 p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                This record was deleted on <span className="font-medium">{formatDateTime(entry.createdAt)}</span> by{" "}
                <span className="font-medium">{entry.userName}</span>. Showing historical snapshot — this record no
                longer exists and can&apos;t be edited.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
              <div>
                <p className="text-xs text-muted-foreground">Entity Type</p>
                <p className="font-medium">{entityTypeLabel(entry.entityType)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Date Created</p>
                <p className="font-medium">{snapshot.created_at ? formatValue(snapshot.created_at) : "—"}</p>
              </div>
              {curated.map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium">{f.value}</p>
                </div>
              ))}
              <div>
                <p className="text-xs text-muted-foreground">Date Deleted</p>
                <p className="font-medium">{formatDateTime(entry.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Performing Admin</p>
                <p className="font-medium">{entry.userName}</p>
              </div>
            </div>

            {otherKeys.length > 0 && (
              <div className="space-y-1.5 rounded-md border p-2.5">
                <p className="text-xs text-muted-foreground mb-1">Full snapshot</p>
                {otherKeys.map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{fieldLabel(key)}</span>
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
