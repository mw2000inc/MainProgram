"use client"

import { Download, CheckCircle2 } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useInstallPrompt } from "@/components/pwa/install-prompt-context"

// Lives in the existing account dropdown (see topbar.tsx) — no new nav
// surface. Renders nothing at all on browsers that never fire
// beforeinstallprompt (Safari on iOS/iPadOS, older/unsupported browsers),
// which is the correct graceful fallback rather than a dead button.
export function InstallAppMenuItem() {
  const { canInstall, installed, promptInstall } = useInstallPrompt()

  if (installed) {
    return (
      <DropdownMenuItem disabled>
        <CheckCircle2 className="h-4 w-4" />
        MW2000 is already installed
      </DropdownMenuItem>
    )
  }

  if (!canInstall) return null

  return (
    <DropdownMenuItem onClick={promptInstall}>
      <Download className="h-4 w-4" />
      Install MW2000 App
    </DropdownMenuItem>
  )
}
