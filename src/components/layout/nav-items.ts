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
  type LucideIcon,
} from "lucide-react"
import type { Permission } from "@/lib/auth/auth-context"

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
  requires?: Permission
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Daily Report", icon: ClipboardList },
  { href: "/customers", label: "Member", icon: Users },
  { href: "/schedule", label: "Schedule", icon: CalendarClock },
  { href: "/install", label: "Install", icon: HardHat },
  { href: "/filter-change", label: "Filter Change", icon: Droplets },
  { href: "/repair-plan", label: "Repair Plan", icon: Wrench },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/sale-list", label: "Sale List", icon: ClipboardCheck },
  { href: "/users", label: "Users", icon: UserCog, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
]
