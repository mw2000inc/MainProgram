import {
  ClipboardCheck,
  HardHat,
  Wrench,
  Droplets,
  Users,
  Package,
  CalendarClock,
  UserCog,
  Settings,
  Table2,
  PhilippinePeso,
  Layers,
  HandHeart,
  History,
  Hammer,
  ReceiptText,
  type LucideIcon,
} from "lucide-react"
import type { Permission } from "@/lib/auth/auth-context"

export interface NavItem {
  href: string
  // English fallback / CommandPalette search text — the actual displayed
  // label always comes from t(item.key, "nav") instead (see sidebar.tsx and
  // command-palette.tsx), so `label` only matters for search matching and
  // as the last-resort fallback the translation lookup itself already
  // provides.
  label: string
  key: string
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
  { href: "/", label: "Daily Report", key: "dailyReport", icon: Table2, group: 1, technicianVisible: true },
  // The MW CP launcher page: cards for CP System, Member, Sale List, Filter
  // Change and Collection (like AppSheet's "MW CP" view).
  { href: "/mw-cp", label: "MW CP", key: "mwCp", icon: HandHeart, group: 2 },
  { href: "/release-slip", label: "Release Slip", key: "releaseSlip", icon: ReceiptText, group: 1, technicianVisible: true },
  { href: "/schedule", label: "Schedule", key: "schedule", icon: CalendarClock, group: 1 },
  { href: "/install", label: "Install", key: "install", icon: HardHat, group: 1 },
  { href: "/filter-change", label: "Filter Change", key: "filterChange", icon: Droplets, group: 1 },
  { href: "/repair-plan", label: "Repair Plan", key: "repairPlan", icon: Wrench, group: 1 },

  { href: "/collection-plan", label: "Collection Plan", key: "collectionPlan", icon: PhilippinePeso, group: 2 },
  { href: "/inventory", label: "Inventory", key: "inventory", icon: Package, group: 2 },
  { href: "/customers", label: "Member", key: "member", icon: Users, group: 2 },
  { href: "/sale-list", label: "Sale List", key: "saleList", icon: ClipboardCheck, group: 2 },
  { href: "/cp-system", label: "CP System", key: "cpSystem", icon: Layers, group: 2 },

  { href: "/users", label: "Users", key: "users", icon: UserCog, adminOnly: true, group: 3 },
  { href: "/activity", label: "Admin Activity", key: "adminActivity", icon: History, adminOnly: true, group: 3 },
  { href: "/technician-activity", label: "Technician Activity", key: "technicianActivity", icon: Hammer, adminOnly: true, group: 3 },
  { href: "/settings", label: "Settings", key: "settings", icon: Settings, adminOnly: true, group: 3 },
]

export function isTechnicianAllowedPath(pathname: string): boolean {
  return NAV_ITEMS.some(
    (item) => item.technicianVisible && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href))
  )
}

// =========================================================================
// The sidebar's layout, matching AppSheet's left rail: Inventory, MW CP,
// Install, Repair, Daily Report, then Schedule and Release Slip; admin pages
// at the bottom. MW CP opens its own page of cards (MW_CP_CARDS) — its five
// pages aren't listed in the rail, and MW CP stays highlighted while one of
// them is open. Same routes as NAV_ITEMS (looked up by href, so permissions
// stay exactly the same) — this only arranges them and, where AppSheet uses a
// different name, gives the label key to show.
// =========================================================================
export type NavLink = { href: string; labelKey?: string; activeFor?: string[] }

// The MW CP page's cards, in AppSheet's order. CP System is this program's
// own CP System page.
export const MW_CP_CARDS: NavLink[] = [
  { href: "/cp-system", labelKey: "navCpSystem" },
  { href: "/customers" },
  { href: "/sale-list" },
  { href: "/filter-change" },
  { href: "/collection-plan", labelKey: "navCollection" },
]

export const NAV_LAYOUT: NavLink[] = [
  { href: "/inventory" },
  { href: "/mw-cp", activeFor: MW_CP_CARDS.map((c) => c.href) },
  { href: "/install" },
  { href: "/repair-plan", labelKey: "navRepair" },
  { href: "/" },
  { href: "/schedule" },
  { href: "/release-slip" },
]

// Admin pages, pinned to the bottom of the rail.
export const NAV_BOTTOM_HREFS = ["/users", "/activity", "/technician-activity", "/settings"]

// Reached from the MW CP page instead of the rail (still in the search palette).
export const NAV_SIDEBAR_HIDDEN_HREFS = MW_CP_CARDS.map((c) => c.href)

export function navItemFor(href: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.href === href)
}
