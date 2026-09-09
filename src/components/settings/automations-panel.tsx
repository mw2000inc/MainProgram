"use client"

import * as React from "react"
import { PlayCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useAutomations, useTriggerAutomation } from "@/lib/hooks/use-automations"
import { useSettings, useUpdateSettings } from "@/lib/hooks/use-misc"
import { useTranslation } from "@/lib/i18n/i18n-context"

// Admin-only view over the Automation Hub's registry (src/lib/automations/
// registry.ts) — every automated background task this app runs (schedule-
// window extension, due-filter-change job generation, the legacy inventory
// deduction job), whether it's currently on or off, and a manual "Run now"
// that goes through the exact same engine/logging its own cron route does
// (see /api/automations/trigger). Toggling here writes straight to
// company_settings.automation_settings via the same useUpdateSettings()
// mutation every other Settings field already uses — this is one more
// admin-configurable setting, not a separate save flow.
export function AutomationsPanel() {
  const { t } = useTranslation("settings")
  const { data: automations, isPending } = useAutomations()
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const triggerAutomation = useTriggerAutomation()
  const [runningId, setRunningId] = React.useState<string | undefined>(undefined)

  async function handleToggle(id: string, checked: boolean) {
    await updateSettings.mutateAsync({
      automationSettings: { ...(settings?.automationSettings ?? {}), [id]: checked },
    })
  }

  async function handleRunNow(id: string) {
    setRunningId(id)
    await triggerAutomation.mutateAsync(id).finally(() => setRunningId(undefined))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("automationsTitle")}</CardTitle>
        <CardDescription>{t("automationsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          (automations ?? []).map((automation) => (
            <div key={automation.id} className="flex items-center gap-3 rounded-md border p-2.5">
              <Switch
                checked={automation.enabled}
                disabled={updateSettings.isPending}
                onCheckedChange={(checked) => handleToggle(automation.id, checked)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{automation.label}</p>
                <p className="text-xs text-muted-foreground">{automation.description}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled={runningId === automation.id}
                onClick={() => handleRunNow(automation.id)}
              >
                <PlayCircle className="h-3.5 w-3.5" />
                {runningId === automation.id ? t("automationRunning") : t("automationRunNow")}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
