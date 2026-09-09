"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { actionLabel, entityTypeLabel, fieldLabel } from "@/lib/activity-log-config"
import { useUsers } from "@/lib/hooks/use-misc"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"

// A raw uuid, matched before deciding how to render a diffed value —
// user_id/customer_id-shaped columns get resolved to a real name below
// instead of dumping the 36-character string; anything else UUID-shaped
// (schedule_job_id, sale_list_entry_id, confirmation_token, ...) still
// isn't a name a person recognizes, so it's shortened rather than left in
// full or given a fake-looking resolved label.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const USER_ID_FIELDS = new Set(["created_by", "updated_by", "rejected_by", "user_id", "technician_user_id", "technician_2_user_id"])
const CUSTOMER_ID_FIELDS = new Set(["customer_id"])

function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value
}

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

// Same rendering as formatValue(), but field-key-aware — a user/customer id
// column is resolved to that person's actual name (falling back to a short
// id, never the full 36-character uuid, if the record behind it is gone or
// this is some other unmapped id column entirely) instead of being dumped
// as a raw string hash.
function formatFieldValue(
  key: string,
  value: unknown,
  userNameById: Map<string, string>,
  customerNameById: Map<string, string>
): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string" && UUID_RE.test(value)) {
    if (USER_ID_FIELDS.has(key)) return userNameById.get(value) ?? shortId(value)
    if (CUSTOMER_ID_FIELDS.has(key)) return customerNameById.get(value) ?? shortId(value)
    return shortId(value)
  }
  return formatValue(value)
}

export function ActivityDetailDialog({
  entry,
  onOpenChange,
}: {
  entry: ActivityLogEntry | undefined
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("activity")
  const { data: users = [] } = useUsers()
  const { data: customers = [] } = useCustomers()
  const userNameById = React.useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const customerNameById = React.useMemo(
    () => new Map(customers.map((c) => [c.id, c.companyName || c.fullName])),
    [customers]
  )

  const isUpdate = entry?.action === "update"

  // Before/after pairs for an update, filtered down to fields that actually
  // have something to show on at least one side — a field the audit
  // trigger logged as "changed" can still format to an empty "—" on both
  // sides here (e.g. null -> ""), which is exactly the kind of dead row
  // this view shouldn't bother showing.
  const updateRows = React.useMemo(() => {
    if (!entry || !isUpdate) return []
    const keys = Array.from(new Set([...Object.keys(entry.oldValues), ...Object.keys(entry.newValues)]))
    return keys
      .map((key) => ({
        key,
        before: formatFieldValue(key, entry.oldValues[key], userNameById, customerNameById),
        after: formatFieldValue(key, entry.newValues[key], userNameById, customerNameById),
      }))
      .filter((row) => row.before !== "—" || row.after !== "—")
  }, [entry, isUpdate, userNameById, customerNameById])

  // Single-value rows for an insert (newValues) or delete (oldValues),
  // same empty-row filtering as above.
  const singleRows = React.useMemo(() => {
    if (!entry || isUpdate) return []
    const source = entry.action === "delete" ? entry.oldValues : entry.newValues
    return Object.keys(source)
      .map((key) => ({ key, value: formatFieldValue(key, source[key], userNameById, customerNameById) }))
      .filter((row) => row.value !== "—")
  }, [entry, isUpdate, userNameById, customerNameById])

  const hasRows = isUpdate ? updateRows.length > 0 : singleRows.length > 0

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
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

            {!hasRows && <p className="text-muted-foreground">{t("noFieldLevelDetails")}</p>}

            {isUpdate ? (
              <div className="space-y-3">
                {updateRows.map(({ key, before, after }) => (
                  <div key={key} className="grid grid-cols-2 gap-3 rounded-md border p-2.5">
                    <div>
                      <p className="text-xs text-muted-foreground">{fieldLabel(key, t)} — {t("before")}</p>
                      <p className="wrap-break-word">{before}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{fieldLabel(key, t)} — {t("after")}</p>
                      <p className="wrap-break-word">{after}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              singleRows.length > 0 && (
                <div className="space-y-1.5 rounded-md border p-2.5">
                  {singleRows.map(({ key, value }) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{fieldLabel(key, t)}</span>
                      <span className="text-right wrap-break-word">{value}</span>
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
