"use client"

import * as React from "react"
import { useAuth } from "@/lib/auth/auth-context"
import { useNotifications } from "@/lib/hooks/use-misc"

// The bell's notifications for whoever is signed in: saved warning / error
// pop-ups (types "warning" / "error", AppMessageLogger) are for admins, so a
// technician's bell leaves them out; everything else is unchanged.
export function useAdminVisibleNotifications() {
  const { user } = useAuth()
  const query = useNotifications()
  const isAdmin = user?.role === "admin"
  const data = React.useMemo(
    () => (isAdmin ? query.data : query.data?.filter((n) => n.type !== "warning" && n.type !== "error")),
    [query.data, isAdmin]
  )
  return { ...query, data }
}
