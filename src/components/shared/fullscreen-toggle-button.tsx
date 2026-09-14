"use client"

import { Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn } from "@/lib/utils"

// Shared by the three approval panels' Full-Screen toggle (Daily Report/
// Pending Approvals, Dispatch Approval, Inventory Approval) — icon-only,
// matching the compact "ghost, h-7, icon + optional short label" shape
// their existing History buttons already use, with the tooltip standing in
// for a visible label rather than adding more text to an already-busy
// header row. See use-fullscreen-toggle.ts for the state/Escape-key half
// of this feature; this component is purely the button.
export function FullScreenToggleButton({
  isFullScreen,
  onToggle,
  className,
}: {
  isFullScreen: boolean
  onToggle: () => void
  className?: string
}) {
  const { t } = useTranslation("common")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("shrink-0", className)}
          aria-label={t("toggleFullScreen")}
          onClick={onToggle}
        >
          {isFullScreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("toggleFullScreen")}</TooltipContent>
    </Tooltip>
  )
}
