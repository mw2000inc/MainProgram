"use client"

import * as React from "react"
import "leaflet/dist/leaflet.css"
import type L from "leaflet"
import { Loader2, Navigation, RotateCw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { fetchDirections } from "@/lib/geo-client"
import { makePinIcon } from "@/lib/leaflet-icons"
import { useTranslation } from "@/lib/i18n/i18n-context"

type Status = "loading" | "ready" | "no-route" | "error"

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Driving directions from the MW2000 office (company_settings.address) to a
// member's address — opened by clicking the Address field on their detail
// panel. A modal fits this better than a dedicated page/panel since it's a
// one-off lookup, not something an admin browses between records. Routing
// comes from OSRM's free public demo server (no key, no billing).
type GeoPoint = { lat: number; lon: number }

export function MemberDirectionsDialog({
  open,
  onOpenChange,
  originAddress,
  originCoords,
  onOriginGeocoded,
  destinationAddress,
  destinationCoords,
  onDestinationGeocoded,
  destinationLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  originAddress: string
  // Already-known coordinates (e.g. company_settings.latitude/longitude) —
  // when given, this side skips server-side geocoding entirely instead of
  // re-resolving the same fixed office address on every single lookup.
  originCoords?: GeoPoint
  // Called once, only when originCoords was absent and a fresh geocode just
  // succeeded, so the caller can cache it (see updateSettingsCoordinates)
  // for next time. Fire-and-forget — a failure to persist isn't a
  // user-facing error, this lookup already succeeded either way.
  onOriginGeocoded?: (lat: number, lon: number) => void
  destinationAddress: string
  destinationCoords?: GeoPoint
  onDestinationGeocoded?: (lat: number, lon: number) => void
  destinationLabel: string
}) {
  const { t } = useTranslation("member")
  const mapDivRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<L.Map | null>(null)
  const [status, setStatus] = React.useState<Status>("loading")
  const [errorMessage, setErrorMessage] = React.useState("")
  // False for the "address missing" validation case, where retrying can't
  // help; true for a Nominatim/OSRM request failure, where it's a free
  // public service that can occasionally rate-limit or time out.
  const [retryable, setRetryable] = React.useState(false)
  const [summary, setSummary] = React.useState<{ distanceKm: string; durationMin: string } | null>(null)
  const [retryToken, setRetryToken] = React.useState(0)

  // originCoords/destinationCoords are plain object literals the caller
  // typically constructs inline (a new reference every render), and the
  // geocoded callbacks are usually inline too — putting any of these in the
  // effect's dependency array would re-run (and re-fetch/re-render the map)
  // on every unrelated parent re-render, not just when the addresses
  // actually change or the user clicks retry. A ref always exposes the
  // latest value to the effect without being a dependency itself.
  const latestRef = React.useRef({ originCoords, onOriginGeocoded, destinationCoords, onDestinationGeocoded })
  React.useEffect(() => {
    latestRef.current = { originCoords, onOriginGeocoded, destinationCoords, onDestinationGeocoded }
  })

  React.useEffect(() => {
    if (!open) return
    if (!originAddress.trim() || !destinationAddress.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("error")
      setRetryable(false)
      setErrorMessage(!originAddress.trim() ? t("officeAddressNotSet") : t("memberHasNoAddress"))
      return
    }
    setStatus("loading")
    setSummary(null)
    let cancelled = false

    async function run() {
      const { originCoords: knownOrigin, onOriginGeocoded, destinationCoords: knownDestination, onDestinationGeocoded } =
        latestRef.current
      const [{ default: leaflet }, result] = await Promise.all([
        import("leaflet"),
        fetchDirections(originAddress, destinationAddress, knownOrigin, knownDestination),
      ])
      if (cancelled || !mapDivRef.current) return

      if ("error" in result) {
        setStatus(result.error.toLowerCase().includes("route") ? "no-route" : "error")
        setRetryable(true)
        setErrorMessage(result.error)
        return
      }

      if (!knownOrigin) onOriginGeocoded?.(result.origin.lat, result.origin.lon)
      if (!knownDestination) onDestinationGeocoded?.(result.destination.lat, result.destination.lon)

      mapRef.current?.remove()
      const map = leaflet.map(mapDivRef.current)
      leaflet.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
      mapRef.current = map

      const line = leaflet
        .polyline(
          result.geometry.map(([lon, lat]) => [lat, lon] as [number, number]),
          { color: "#2563eb", weight: 5 }
        )
        .addTo(map)

      leaflet.marker([result.origin.lat, result.origin.lon], { icon: makePinIcon(leaflet, "#16a34a") }).addTo(map).bindTooltip("MW2000 Office")
      leaflet
        .marker([result.destination.lat, result.destination.lon], { icon: makePinIcon(leaflet, "#dc2626") })
        .addTo(map)
        .bindTooltip(destinationLabel)

      map.fitBounds(line.getBounds(), { padding: [32, 32] })

      setSummary({
        distanceKm: (result.distanceMeters / 1000).toFixed(1),
        durationMin: Math.round(result.durationSeconds / 60).toString(),
      })
      setStatus("ready")
    }

    run().catch(() => {
      if (cancelled) return
      setStatus("error")
      setRetryable(true)
      setErrorMessage(t("failedToLoadDirections"))
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [open, originAddress, destinationAddress, destinationLabel, retryToken, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Navigation className="h-4 w-4" /> {t("directionsTo", { name: destinationLabel })}
          </DialogTitle>
          <DialogDescription>
            {t("drivingRouteDescription", { address: destinationAddress || t("thisMembersAddress") })}
          </DialogDescription>
        </DialogHeader>

        {status === "error" && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <p>{t("directionsUnavailable")}</p>
            <p className="text-xs">{errorMessage}</p>
            {retryable && (
              <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={() => setRetryToken((n) => n + 1)}>
                <RotateCw className="h-3.5 w-3.5" /> {t("tryAgain")}
              </Button>
            )}
          </div>
        )}
        {status === "no-route" && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <p>{t("noRouteFound")}</p>
            <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={() => setRetryToken((n) => n + 1)}>
              <RotateCw className="h-3.5 w-3.5" /> {t("tryAgain")}
            </Button>
          </div>
        )}
        {(status === "loading" || status === "ready") && (
          <>
            {summary && (
              <p className="text-sm text-muted-foreground">
                {t("distanceSummary", { km: summary.distanceKm, min: summary.durationMin })}
              </p>
            )}
            <div className="relative h-[420px] w-full">
              {/* Geocoding the office address can take a few seconds (it
                  often needs several fallback attempts — see
                  nominatim-server.ts) — without this, the map area was just a
                  blank box that easily read as broken rather than working. */}
              {status === "loading" && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-md border bg-muted/40 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("loadingDirections")}
                </div>
              )}
              <div ref={mapDivRef} className="h-full w-full rounded-md border" />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
