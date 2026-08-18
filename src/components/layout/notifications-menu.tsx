"use client"

import Link from "next/link"
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
import { formatDateTime } from "@/lib/utils"
import type { NotificationType } from "@/lib/types"
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
  const { data: notifications = [] } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const unreadCount = notifications.filter((n) => !n.isRead).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
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
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => markAllRead.mutate()}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</div>
          )}
          {notifications.slice(0, 8).map((n) => {
            const Icon = ICONS[n.type]
            return (
              <button
                key={n.id}
                onClick={() => markRead.mutate(n.id)}
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
          <Link href="/notifications">
            <Button variant="ghost" size="sm" className="w-full text-xs">
              View all notifications
            </Button>
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
