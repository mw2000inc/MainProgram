"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { ContractStatus, MonitoringViewStatus, PaymentStatus, StockStatus } from "@/lib/types"

export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "secondary"

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  danger: "bg-danger/10 text-danger border-danger/20",
  secondary: "bg-secondary/10 text-secondary border-secondary/20",
  neutral: "bg-muted text-muted-foreground border-transparent",
}

const DOT_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  secondary: "bg-secondary",
  neutral: "bg-muted-foreground",
}

export function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", TONE_CLASSES[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[tone])} />
      {label}
    </Badge>
  )
}

// Every *StatusBadge below maps a closed enum to a status.json key instead
// of a literal label, so the same tone/translation logic covers both
// languages — unlike PlanStatusBadge further down, which normalizes
// arbitrary free-text status values from the DB and can't rely on a closed
// enum the same way.
const CONTRACT_STATUS_MAP: Record<ContractStatus, { tone: BadgeTone; key: string }> = {
  active: { tone: "success", key: "active" },
  expiring: { tone: "warning", key: "expiringSoon" },
  expired: { tone: "danger", key: "expired" },
}

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const { t } = useTranslation("status")
  const { tone, key } = CONTRACT_STATUS_MAP[status]
  return <StatusBadge tone={tone} label={t(key)} />
}

const MONITORING_STATUS_MAP: Record<MonitoringViewStatus, { tone: BadgeTone; key: string }> = {
  active: { tone: "success", key: "active" },
  expiring: { tone: "warning", key: "expiringSoon" },
  "for-replacement": { tone: "danger", key: "forReplacement" },
}

export function MonitoringViewStatusBadge({ status }: { status: MonitoringViewStatus }) {
  const { t } = useTranslation("status")
  const { tone, key } = MONITORING_STATUS_MAP[status]
  return <StatusBadge tone={tone} label={t(key)} />
}

const STOCK_STATUS_MAP: Record<StockStatus, { tone: BadgeTone; key: string }> = {
  "in-stock": { tone: "success", key: "inStock" },
  "low-stock": { tone: "warning", key: "lowStock" },
  "out-of-stock": { tone: "danger", key: "outOfStock" },
}

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const { t } = useTranslation("status")
  const { tone, key } = STOCK_STATUS_MAP[status]
  return <StatusBadge tone={tone} label={t(key)} />
}

const PAYMENT_STATUS_MAP: Record<PaymentStatus, { tone: BadgeTone; key: string }> = {
  Paid: { tone: "success", key: "paid" },
  Pending: { tone: "warning", key: "pending" },
  Overdue: { tone: "danger", key: "overdue" },
  Partial: { tone: "secondary", key: "partial" },
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation("status")
  const { tone, key } = PAYMENT_STATUS_MAP[status]
  return <StatusBadge tone={tone} label={t(key)} />
}

// The known values this app's plan tables (filter change, install, repair,
// collection, schedule jobs) actually use — anything else falls back to the
// original, capitalized-as-typed text rather than guessing at a
// translation, since this field is free text in the DB, not a real enum.
const PLAN_STATUS_KEYS: Record<string, string> = {
  pending: "pending",
  completed: "completed",
  done: "completed",
  active: "active",
  collected: "collected",
  cancelled: "cancelled",
  canceled: "cancelled",
}

// Free-text status used by the daily-report plan tables (filter change, install,
// repair, collection, schedule jobs) — normalizes common values to a tone.
export function PlanStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("status")
  const normalized = status.toLowerCase()
  let tone: BadgeTone = "warning"
  if (normalized === "completed" || normalized === "done" || normalized === "active" || normalized === "collected") tone = "success"
  else if (normalized === "cancelled" || normalized === "canceled") tone = "danger"
  const key = PLAN_STATUS_KEYS[normalized]
  const label = key ? t(key) : status.charAt(0).toUpperCase() + status.slice(1)
  return <StatusBadge tone={tone} label={label} />
}
