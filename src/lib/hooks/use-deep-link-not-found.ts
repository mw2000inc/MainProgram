import * as React from "react"
import { toast } from "sonner"

// Shared by every list page that accepts a `?id=` deep link (from clicking
// an Activity Log entry, or the Daily Report panels that already used this
// convention beforehand) — shows a one-time toast when that id doesn't
// match any row once the backing query has actually finished loading, most
// likely because the record was deleted after the log entry was written.
// Takes the *raw* fetched list, not whatever a page's own search/filter
// state currently shows, so a deep link is never wrongly reported missing
// just because a search box or filter would otherwise hide it.
export function useDeepLinkNotFoundToast(initialId: string | undefined, isPending: boolean, found: boolean) {
  const notifiedRef = React.useRef(false)
  React.useEffect(() => {
    if (!initialId || isPending || found || notifiedRef.current) return
    notifiedRef.current = true
    toast.error("This record no longer exists.")
  }, [initialId, isPending, found])
}
