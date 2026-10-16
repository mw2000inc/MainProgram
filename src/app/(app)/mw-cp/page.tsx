"use client"

import Link from "next/link"
import { Calculator, HandHeart, HeartHandshake, Package, PhilippinePeso, UserRound, type LucideIcon } from "lucide-react"
import { MW_CP_CARDS, navItemFor, type NavItem } from "@/components/layout/nav-items"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"

// The MW CP view, like AppSheet's: one big card per module — CP System,
// Member, Sale List, Filter Change, Collection (MW_CP_CARDS) — each a large
// outlined icon with its name. Only the modules this person can open (the
// sidebar's rules).
const CARD_ICONS: Record<string, LucideIcon> = {
  "/cp-system": Package,
  "/customers": UserRound,
  "/sale-list": Calculator,
  "/filter-change": HeartHandshake,
  "/collection-plan": PhilippinePeso,
}

export default function MwCpPage() {
  const { t } = useTranslation("nav")
  const { user } = useAuth()
  const canOpen = (item: NavItem | undefined): item is NavItem =>
    !!item && !(item.adminOnly && user?.role !== "admin") && !(user?.role === "technician" && !item.technicianVisible)
  const cards = MW_CP_CARDS.flatMap((c) => {
    const item = navItemFor(c.href)
    return canOpen(item) ? [{ ...c, item }] : []
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <HandHeart className="h-6 w-6 text-primary" /> {t("mwCp")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("mwCpDescription")}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-testid="mwcp-cards">
        {cards.map((c) => {
          const Icon = CARD_ICONS[c.href] ?? c.item.icon
          return (
            <Link
              key={c.href}
              href={c.href}
              data-testid="mwcp-card"
              className="group flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span className="flex aspect-square items-center justify-center">
                <Icon className="h-3/5 w-3/5 text-foreground transition-transform duration-200 group-hover:scale-105 motion-reduce:group-hover:scale-100" strokeWidth={1.4} aria-hidden />
              </span>
              <span className="mt-2 text-sm font-medium">{t(c.labelKey ?? c.item.key)}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
