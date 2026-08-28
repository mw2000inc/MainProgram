"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { ThemeProvider } from "next-themes"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider } from "@/lib/auth/auth-context"
import { SidebarCollapseProvider } from "@/lib/sidebar-collapse-context"
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker"
import { InstallPromptProvider } from "@/components/pwa/install-prompt-context"

// Navigating away (e.g. clicking a sidebar link) while a Radix Dialog/Popover is
// still open skips its normal close cleanup, leaving `body { pointer-events: none }`
// stuck — which makes every page, including this one, permanently unclickable
// until a hard refresh. Clearing it on every route change is a self-healing fix.
function RouteChangeCleanup() {
  const pathname = usePathname()
  React.useEffect(() => {
    document.body.style.pointerEvents = ""
  }, [pathname])
  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delayDuration={200}>
            <SidebarCollapseProvider>
              <InstallPromptProvider>
                <RouteChangeCleanup />
                <RegisterServiceWorker />
                {children}
                <Toaster richColors position="top-right" closeButton />
              </InstallPromptProvider>
            </SidebarCollapseProvider>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
