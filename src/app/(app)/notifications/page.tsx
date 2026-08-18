"use client"

import * as React from "react"
import { AlertTriangle, Bell, FileWarning, PackageX, Receipt, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/lib/hooks/use-misc"
import { cn, formatDateTime } from "@/lib/utils"
import type { NotificationType } from "@/lib/types"

const ICONS: Record<NotificationType, React.ElementType> = {
  "low-stock": AlertTriangle,
  "out-of-stock": PackageX,
  "expiring-contract": FileWarning,
  "new-customer": UserPlus,
  "new-sale": Receipt,
}

const ICON_COLORS: Record<NotificationType, string> = {
  "low-stock": "bg-warning/10 text-warning",
  "out-of-stock": "bg-danger/10 text-danger",
  "expiring-contract": "bg-warning/10 text-warning",
  "new-customer": "bg-secondary/10 text-secondary",
  "new-sale": "bg-success/10 text-success",
}

const TYPE_LABELS: Record<NotificationType, string> = {
  "low-stock": "Low Inventory",
  "out-of-stock": "Out of Stock",
  "expiring-contract": "Expiring Contract",
  "new-customer": "New Customer",
  "new-sale": "New Sale",
}

type TypeFilter = "all" | NotificationType

export default function NotificationsPage() {
  const { data: notifications = [], isPending } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all")
  const [readFilter, setReadFilter] = React.useState<"all" | "unread" | "read">("all")

  const filtered = React.useMemo(() => {
    return notifications.filter((n) => {
      if (typeFilter !== "all" && n.type !== typeFilter) return false
      if (readFilter === "unread" && n.isRead) return false
      if (readFilter === "read" && !n.isRead) return false
      return true
    })
  }, [notifications, typeFilter, readFilter])

  const unreadCount = notifications.filter((n) => !n.isRead).length

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" /> Notifications
          </h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? `You have ${unreadCount} unread notification(s).` : "You're all caught up."}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" onClick={() => markAllRead.mutate()} className="gap-1.5">
            Mark all as read
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="h-9 w-[190px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={readFilter} onValueChange={(v) => setReadFilter(v as typeof readFilter)}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="read">Read</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6 divide-y">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-12 text-center">No notifications found.</p>
          )}
          {filtered.map((n) => {
            const Icon = ICONS[n.type]
            return (
              <button
                key={n.id}
                onClick={() => markRead.mutate(n.id)}
                className={cn(
                  "flex w-full items-start gap-3 py-4 text-left transition-colors hover:bg-muted/50 first:pt-0 last:pb-0",
                  !n.isRead && "bg-accent/30"
                )}
              >
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", ICON_COLORS[n.type])}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn("text-sm", !n.isRead && "font-medium")}>{n.message}</p>
                    {!n.isRead && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {TYPE_LABELS[n.type]} &middot; {formatDateTime(n.createdAt)}
                  </p>
                </div>
              </button>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
