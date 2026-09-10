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
      {/* flex flex-col here (plus overflow-hidden, see below) overrides
          DropdownMenuContent's own base overflow-y-auto (see
          dropdown-menu.tsx) — that class was the actual original bug: with
          header/list/footer just stacked in plain block flow, this outer
          element could end up scrolling as a whole (its own max-h is
          Radix's own available-viewport-space var) at the same time the
          list scrolled its own content, and the two fighting over the same
          space is what looked like the footer and the last item
          overlapping/getting cut off. overflow-hidden is kept here
          deliberately, even though it's not in every reference snippet for
          this pattern: dropping it lets that same base overflow-y-auto
          reappear (cn()/tailwind-merge only removes it when a competing
          overflow-* utility is actually present in this className), which
          is exactly the "content still bleeding past the footer" symptom.
          Header and footer keep their natural size (shrink-0); only the
          plain div below scrolls — the same header/scrollable-middle/
          footer split data-table.tsx already uses for its own toolbar/
          table/pagination. */}
      <DropdownMenuContent align="end" className="flex w-80 flex-col overflow-hidden p-0">
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">{t("pageTitle")}</span>
          {unreadCount > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => markAllRead.mutate()}>
              {t("markAllReadShort")}
            </Button>
          )}
        </div>
        {/* A plain overflow-y-auto div, not the Radix ScrollArea component —
            ScrollArea's own Viewport wraps its content in an extra layer
            Radix sizes/measures itself, which turned out not to compute a
            usable height (and so never showed a scrollbar, custom or
            native) once this sat inside a flex column instead of a plain
            block parent. A native div's own overflow-y-auto has no such
            indirection: max-h-64 caps it (hugging shorter content, capping
            and scrolling past that, same as before regardless of how much
            extra room the viewport happens to leave), and the browser's own
            scrollbar renders directly — nothing here suppresses it
            (no overflow-hidden/scrollbar-none/no-scrollbar on this div or
            between it and its own content). pr-1 keeps that scrollbar from
            sitting flush against the text; pb-1 gives the last item
            breathing room above the footer. */}
        <div className="max-h-64 overflow-y-auto pr-1 pb-1">
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
        </div>
        <div className="shrink-0 p-2 border-t bg-popover">
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
