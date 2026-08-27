import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
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

const CONTRACT_STATUS_MAP: Record<ContractStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  expiring: { tone: "warning", label: "Expiring Soon" },
  expired: { tone: "danger", label: "Expired" },
}

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const { tone, label } = CONTRACT_STATUS_MAP[status]
  return <StatusBadge tone={tone} label={label} />
}

const MONITORING_STATUS_MAP: Record<MonitoringViewStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  expiring: { tone: "warning", label: "Expiring Soon" },
  "for-replacement": { tone: "danger", label: "For Replacement" },
}

export function MonitoringViewStatusBadge({ status }: { status: MonitoringViewStatus }) {
  const { tone, label } = MONITORING_STATUS_MAP[status]
  return <StatusBadge tone={tone} label={label} />
}

const STOCK_STATUS_MAP: Record<StockStatus, { tone: BadgeTone; label: string }> = {
  "in-stock": { tone: "success", label: "In Stock" },
  "low-stock": { tone: "warning", label: "Low Stock" },
  "out-of-stock": { tone: "danger", label: "Out of Stock" },
}

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const { tone, label } = STOCK_STATUS_MAP[status]
  return <StatusBadge tone={tone} label={label} />
}

const PAYMENT_STATUS_MAP: Record<PaymentStatus, { tone: BadgeTone; label: string }> = {
  Paid: { tone: "success", label: "Paid" },
  Pending: { tone: "warning", label: "Pending" },
  Overdue: { tone: "danger", label: "Overdue" },
  Partial: { tone: "secondary", label: "Partial" },
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { tone, label } = PAYMENT_STATUS_MAP[status]
  return <StatusBadge tone={tone} label={label} />
}

// Free-text status used by the daily-report plan tables (filter change, install,
// repair, collection, schedule jobs) — normalizes common values to a tone.
export function PlanStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  let tone: BadgeTone = "warning"
  if (normalized === "completed" || normalized === "done" || normalized === "active" || normalized === "collected") tone = "success"
  else if (normalized === "cancelled" || normalized === "canceled") tone = "danger"
  const label = status.charAt(0).toUpperCase() + status.slice(1)
  return <StatusBadge tone={tone} label={label} />
}
