"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ShieldAlert } from "lucide-react"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const { t } = useTranslation("common")

  React.useEffect(() => {
    if (!loading && user && user.role !== "admin") router.replace("/")
  }, [loading, user, router])

  if (loading || !user || user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">{t("checkingAccess")}</p>
      </div>
    )
  }

  return <>{children}</>
}
