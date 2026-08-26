"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { NAV_ITEMS } from "@/components/layout/nav-items"
import { useAuth } from "@/lib/auth/auth-context"
import { Logo } from "@/components/shared/logo"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void
  // Icon-only rail, e.g. while a split-view detail panel is open and needs
  // the extra horizontal space. Labels move into a hover tooltip instead.
  collapsed?: boolean
}) {
  const pathname = usePathname()
  const { user } = useAuth()

  const items = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && user?.role !== "admin") return false
    if (user?.role === "technician" && !item.technicianVisible) return false
    return true
  })

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex items-center gap-2 px-5 py-5", collapsed && "justify-center px-3")}>
        <Logo className="h-9 w-9 shrink-0" />
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="font-semibold text-sm">MW2000</span>
            <span className="text-xs text-muted-foreground">Water Purification ERP</span>
          </div>
        )}
      </div>
      <nav className={cn("flex-1 space-y-1 py-2 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
        {items.map((item, index) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
          const Icon = item.icon
          const link = (
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-2",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          )
          // Between groups, not before the first item — computed off this
          // already-permission-filtered `items` list, so a divider never
          // shows for a group the current user can't see any of (e.g. Users/
          // Settings' group 3 for a technician).
          const showDivider = index > 0 && item.group !== items[index - 1].group
          return (
            <div key={item.href}>
              {showDivider && <Separator className={cn("mb-1", collapsed ? "mx-1" : "mx-2")} />}
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                link
              )}
            </div>
          )
        })}
      </nav>
      {!collapsed && (
        <div className="px-5 py-4 text-xs text-muted-foreground border-t">
          &copy; {new Date().getFullYear()} MW2000 Inc.
        </div>
      )}
    </div>
  )
}
