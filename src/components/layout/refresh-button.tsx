"use client"

import * as React from "react"
import { RefreshCw } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn } from "@/lib/utils"

// Header Refresh (next to the theme toggle): re-fetches every query the
// current page is showing — the Daily Report's widgets, the Schedule, a
// module table, whatever is on screen — straight from the database, without
// a page reload. Spins while it runs; a toast says when it's done.
export function RefreshButton() {
  const qc = useQueryClient()
  const { t } = useTranslation("common")
  const [refreshing, setRefreshing] = React.useState(false)

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    await qc.refetchQueries({ type: "active" })
    const failed = qc.getQueryCache().findAll({ type: "active" }).some((q) => q.state.status === "error")
    setRefreshing(false)
    if (failed) toast.error(t("refreshFailed"))
    else toast.success(t("refreshDone"))
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={refresh}
      disabled={refreshing}
      aria-busy={refreshing}
      aria-label={t("refreshData")}
      title={t("refreshData")}
      data-testid="header-refresh-button"
    >
      <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
    </Button>
  )
}
