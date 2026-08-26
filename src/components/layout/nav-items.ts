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
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Daily Report", icon: ClipboardList, group: 1 },
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
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true, group: 3 },
]
