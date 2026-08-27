import {
  ClipboardList,
  ClipboardCheck,
  HardHat,
  Wrench,
  Droplets,
  Users,
  Package,
  CalendarClock,
  UserCog,
  Settings,
  Banknote,
  Layers,
  History,
  Hammer,
  type LucideIcon,
} from "lucide-react"
import type { Permission } from "@/lib/auth/auth-context"

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
  requires?: Permission
  // Visual grouping for the sidebar's dividers (SidebarNav renders a
  // Separator between consecutive *visible* items whose group differs —
  // "visible" meaning after the adminOnly filter, so a divider never shows
  // for a group a given user can't see any of). Purely cosmetic — the
  // Command Palette reads this same array flat and ignores it.
  group: 1 | 2 | 3
  // A technician's scope is Daily Report only, nothing else — every other
  // module (including the standalone Schedule management page, which has
  // its own Add/Edit/Delete UI for admins) is admin-only in practice (RLS
  // blocks the underlying data too; see the technician_role and
  // technician_readonly_daily_report migrations). A technician's schedule
  // view is the read-only agenda embedded in Daily Report
  // (components/schedule/schedule-agenda.tsx), scoped to their own jobs by
  // schedule_jobs_select — not this page. Defaults to false/hidden when
  // omitted. See isTechnicianAllowedPath below, the single source of truth
  // (app)/layout.tsx's redirect guard reads too, so "what's in the nav" and
  // "what's actually reachable" can't drift apart.
  technicianVisible?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Daily Report", icon: ClipboardList, group: 1, technicianVisible: true },
  { href: "/schedule", label: "Schedule", icon: CalendarClock, group: 1 },
  { href: "/install", label: "Install", icon: HardHat, group: 1 },
  { href: "/filter-change", label: "Filter Change", icon: Droplets, group: 1 },
  { href: "/repair-plan", label: "Repair Plan", icon: Wrench, group: 1 },

  { href: "/collection-plan", label: "Collection Plan", icon: Banknote, group: 2 },
  { href: "/inventory", label: "Inventory", icon: Package, group: 2 },
  { href: "/customers", label: "Member", icon: Users, group: 2 },
  { href: "/sale-list", label: "Sale List", icon: ClipboardCheck, group: 2 },
  { href: "/cp-system", label: "CP System", icon: Layers, group: 2 },

  { href: "/users", label: "Users", icon: UserCog, adminOnly: true, group: 3 },
  { href: "/activity", label: "Admin Activity", icon: History, adminOnly: true, group: 3 },
  { href: "/technician-activity", label: "Technician Activity", icon: Hammer, adminOnly: true, group: 3 },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true, group: 3 },
]

export function isTechnicianAllowedPath(pathname: string): boolean {
  return NAV_ITEMS.some(
    (item) => item.technicianVisible && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href))
  )
}
