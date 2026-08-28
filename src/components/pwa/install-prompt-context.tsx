"use client"

import * as React from "react"

// Chrome/Edge fire this before showing their own install UI; capturing it
// lets us trigger that same native prompt later from our own menu item
// instead of the browser's address-bar icon. Not part of any lib.dom.d.ts
// release yet, hence the manual shape here.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own (non-standard) flag for an already-installed PWA.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

interface InstallPromptState {
  canInstall: boolean
  installed: boolean
  promptInstall: () => Promise<void>
}

const InstallPromptContext = React.createContext<InstallPromptState>({
  canInstall: false,
  installed: false,
  promptInstall: async () => {},
})

// Mounted once at the app root (see providers.tsx) — deliberately NOT local
// state inside the account-menu item itself. beforeinstallprompt fires once,
// early, whenever Chrome/Edge decide the page qualifies, which is almost
// certainly before a user ever opens that dropdown; a listener that only
// exists while the (closed-by-default) dropdown content is mounted would
// miss it entirely and the button would never appear. This context's
// listener lives for the whole session instead, so whatever fires before
// the menu is ever opened is still there when it finally is.
export function InstallPromptProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = React.useState(false)

  React.useEffect(() => {
    // Depends on window.matchMedia, unavailable during SSR — can't be a
    // useState initializer, so this has to run as an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInstalled(isStandalone())

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    function onAppInstalled() {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
    window.addEventListener("appinstalled", onAppInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      window.removeEventListener("appinstalled", onAppInstalled)
    }
  }, [])

  const promptInstall = React.useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === "accepted") setInstalled(true)
    setDeferredPrompt(null)
  }, [deferredPrompt])

  const value = React.useMemo(
    () => ({ canInstall: !installed && !!deferredPrompt, installed, promptInstall }),
    [installed, deferredPrompt, promptInstall]
  )

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>
}

export function useInstallPrompt() {
  return React.useContext(InstallPromptContext)
}
