"use client"

import * as React from "react"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase/client"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { productsKey, stockMovementsKey } from "@/lib/hooks/use-inventory"
import { customersKey } from "@/lib/hooks/use-customers"

// The queries each table's rows feed. A schedule job change can also create,
// link or re-date a module record (the schedule_job_module_sync migration),
// and that record's own change arrives as its own event.
const KEYS_BY_TABLE: Record<string, QueryKey[]> = {
  schedule_jobs: [scheduleJobsKey],
  filter_change_plans: [filterChangePlansKey],
  install_plans: [installPlansKey],
  repair_plans: [repairPlansKey],
  collections: [collectionsKey],
  stock_movements: [stockMovementsKey, productsKey],
  // The Member list's "new" (green) flag, cleared by any admin (20261031000000).
  customers: [customersKey],
}

// A batch (Complete All, an automation run) sends one event per row, so
// changes are gathered for a moment and each query refetched once.
const FLUSH_DELAY_MS = 400

// Keeps every open browser's Daily Report widgets, and the module pages
// reading the same queries, in step with changes made anywhere else — another
// admin, a technician, the dispatch flow, a server automation — without a
// page reload. Uses Supabase Realtime (postgres_changes, which applies RLS).
export function useLiveDataSync(enabled: boolean) {
  const qc = useQueryClient()

  React.useEffect(() => {
    if (!enabled) return
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined

    const flush = () => {
      timer = undefined
      for (const table of pending) {
        for (const queryKey of KEYS_BY_TABLE[table] ?? []) qc.invalidateQueries({ queryKey })
      }
      pending.clear()
    }

    let channel = supabase.channel("live-data-sync")
    for (const table of Object.keys(KEYS_BY_TABLE)) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        pending.add(table)
        timer ??= setTimeout(flush, FLUSH_DELAY_MS)
      })
    }
    channel.subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [enabled, qc])
}
