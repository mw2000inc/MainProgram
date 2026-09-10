"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bell, AlertTriangle, PackageX, FileWarning, UserPlus, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/lib/hooks/use-misc"
import { resolveNotificationTarget } from "@/lib/notification-navigation"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDateTime } from "@/lib/utils"
import type { AppNotification, NotificationType } from "@/lib/types"
import { cn } from "@/lib/utils"

const ICONS: Record<NotificationType, React.ElementType> = {
  "low-stock": AlertTriangle,
  "out-of-stock": PackageX,
  "expiring-contract": FileWarning,
  "new-customer": UserPlus,
  "new-sale": Receipt,
}

const ICON_COLORS: Record<NotificationType, string> = {
  "low-stock": "text-warning",
  "out-of-stock": "text-danger",
  "expiring-contract": "text-warning",
  "new-customer": "text-secondary",
  "new-sale": "text-success",
}

export function NotificationsMenu() {
  const router = useRouter()
  const { t } = useTranslation("notifications")
  const { t: tActivity } = useTranslation("activity")
  const [open, setOpen] = React.useState(false)
  const { data: notifications = [] } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const unreadCount = notifications.filter((n) => !n.isRead).length

  // Same navigation pattern as ActivityLogView's own row click
  // (resolveActivityLogTarget) — reused here via resolveNotificationTarget
  // rather than reinvented, including its two fallback toasts: an
  // unrecognized type gets the generic "no page mapped yet" message, and a
  // type that's confirmed to have no page at all (new-sale, pointing at the
  // legacy sales table) gets its own specific message. A record that *did*
  // have a page but was since deleted isn't handled here at all — same as
  // Activity Log, that's the destination page's own job (its `?id=` deep-
  // link "not found" toast, or a dynamic [id] route's own not-found state),
  // not something this click handler tries to detect itself.
  function handleClick(n: AppNotification) {
    markRead.mutate(n.id)
    setOpen(false)
    const target = resolveNotificationTarget(n)
    if (!target) {
      toast.error(tActivity("noPageMappedYet"))
      return
    }
    if (target.kind === "unavailable") {
      toast.error(tActivity(target.messageKey))
      return
    }
    router.push(target.href)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("pageTitle")}>
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full bg-danger px-1 text-[10px] text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">{t("pageTitle")}</span>
          {unreadCount > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => markAllRead.mutate()}>
              {t("markAllReadShort")}
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t("noNotifications")}</div>
          )}
          {notifications.slice(0, 8).map((n) => {
            const Icon = ICONS[n.type]
            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-muted transition-colors border-b last:border-0",
                  !n.isRead && "bg-accent/40"
                )}
              >
                <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", ICON_COLORS[n.type])} />
                <div className="flex-1 min-w-0">
                  <p className={cn("leading-snug", !n.isRead && "font-medium")}>{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(n.createdAt)}</p>
                </div>
                {!n.isRead && <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
              </button>
            )
          })}
        </ScrollArea>
        <div className="p-2 border-t">
          <Link href="/notifications" onClick={() => setOpen(false)}>
            <Button variant="ghost" size="sm" className="w-full text-xs">
              {t("viewAllNotifications")}
            </Button>
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
