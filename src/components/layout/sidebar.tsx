"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  NAV_BOTTOM_HREFS,
  NAV_ITEMS,
  NAV_LAYOUT,
  NAV_SIDEBAR_HIDDEN_HREFS,
  navItemFor,
  type NavItem,
  type NavLink,
} from "@/components/layout/nav-items"
import { useAuth } from "@/lib/auth/auth-context"
import { Logo } from "@/components/shared/logo"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslation } from "@/lib/i18n/i18n-context"

// The left rail, laid out like AppSheet's (NAV_LAYOUT): Inventory, MW CP (its
// own page of cards for CP System, Member, Sale List, Filter Change and
// Collection — highlighted while any of them is open), Install, Repair, Daily
// Report, Schedule, Release Slip; admin pages pinned to the bottom. A light
// strip of thin-line icons, the open module in light blue (#e8f0fe) with a
// blue icon (#1a73e8) and a blue accent bar on its left edge. Same routes and
// permissions as NAV_ITEMS — the layout only arranges them.

const ACTIVE = "bg-[#e8f0fe] font-medium text-[#1a73e8] dark:bg-blue-500/15 dark:text-blue-300"
const IDLE = "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"

function matches(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

type Resolved = { item: NavItem; label: string; activeFor: string[] }

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void
  // Icon-only rail (the desktop default — see sidebar-collapse-context.tsx).
  // Labels move into hover tooltips.
  collapsed?: boolean
}) {
  const pathname = usePathname()
  const { user } = useAuth()
  const { t } = useTranslation("nav")

  const allowed = (item: NavItem | undefined): item is NavItem => {
    if (!item) return false
    if (item.adminOnly && user?.role !== "admin") return false
    if (user?.role === "technician" && !item.technicianVisible) return false
    return true
  }
  const resolve = (link: NavLink): Resolved | null => {
    const item = navItemFor(link.href)
    return allowed(item) ? { item, label: t(link.labelKey ?? item.key), activeFor: link.activeFor ?? [] } : null
  }
  const main = NAV_LAYOUT.map(resolve).filter((r): r is Resolved => !!r)
  const placed = new Set([...NAV_LAYOUT.map((l) => l.href), ...NAV_BOTTOM_HREFS, ...NAV_SIDEBAR_HIDDEN_HREFS])
  // A page added to NAV_ITEMS later, not placed in the layout yet, still shows.
  const extra = NAV_ITEMS.filter((i) => !placed.has(i.href)).map((i) => resolve({ href: i.href })).filter((r): r is Resolved => !!r)
  const bottom = NAV_BOTTOM_HREFS.map((href) => resolve({ href })).filter((r): r is Resolved => !!r)

  const renderLink = ({ item, label, activeFor }: Resolved) => {
    const active = matches(item.href, pathname) || activeFor.some((href) => matches(href, pathname))
    const Icon = item.icon
    const link = (
      <Link
        href={item.href}
        aria-label={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        data-testid="sidebar-link"
        onClick={(e) => {
          // Already on the Daily Report: drop ?date= so it returns to today.
          // Done by hand (not a router navigation to the same page), which
          // could restore the date the page was first opened with.
          if (item.href === "/" && pathname === "/") {
            e.preventDefault()
            if (window.location.search) window.history.replaceState(null, "", "/")
          }
          onNavigate?.()
        }}
        className={cn(
          "relative flex items-center gap-3 rounded-lg text-sm transition-colors",
          collapsed ? "mx-auto h-10 w-10 justify-center" : "px-3 py-2",
          active ? ACTIVE : IDLE
        )}
      >
        {active && (
          <span aria-hidden data-testid="sidebar-accent" className="absolute -left-3 top-1.5 bottom-1.5 w-0.75 rounded-r-full bg-[#1a73e8] dark:bg-blue-400" />
        )}
        <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.75} />
        {!collapsed && label}
      </Link>
    )
    return (
      <li key={item.href}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              {label}
            </TooltipContent>
          </Tooltip>
        ) : (
          link
        )}
      </li>
    )
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-sidebar">
      <div className={cn("flex items-center gap-2 border-b border-slate-200/80 dark:border-border", collapsed ? "justify-center px-2 py-4" : "px-5 py-5")}>
        <Logo className={cn("shrink-0", collapsed ? "h-8 w-8" : "h-9 w-9")} />
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="font-semibold text-sm">MW2000</span>
            <span className="text-xs text-muted-foreground">Water Purification ERP</span>
          </div>
        )}
      </div>
      <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-3" aria-label="Main">
        <ul className="space-y-1">
          {main.map(renderLink)}
          {extra.map(renderLink)}
        </ul>
        {bottom.length > 0 && (
          <ul className="mt-auto space-y-1 border-t border-slate-200/80 pt-3 dark:border-border" data-testid="sidebar-bottom">
            {bottom.map(renderLink)}
          </ul>
        )}
      </nav>
      {!collapsed && (
        <div className="px-5 py-4 text-xs text-muted-foreground border-t border-slate-200/80 dark:border-border">
          &copy; {new Date().getFullYear()} MW2000 Inc.
        </div>
      )}
    </div>
  )
}
