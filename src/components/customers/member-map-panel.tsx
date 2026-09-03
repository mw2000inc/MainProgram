"use client"

import * as React from "react"
import "leaflet/dist/leaflet.css"
import type L from "leaflet"
import { MapPin, Search } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateCustomerCoordinates } from "@/lib/api/customers"
import { geocodeAddress, sleep } from "@/lib/geo-client"
import { makePinIcon } from "@/lib/leaflet-icons"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { Customer } from "@/lib/types"

const MANILA_CENTER: [number, number] = [14.6091, 121.0223]
// Nominatim's usage policy caps requests at ~1/second — only applied between
// addresses that actually need a fresh geocode; cached pins cost nothing.
const NOMINATIM_MIN_INTERVAL_MS = 1100
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Builds a pin's popup as real DOM nodes (via textContent, not an HTML
// string) so a member's name/address can never break out of the popup as
// markup — then wires the "Get Directions" button to the callback with a
// plain event listener, since Leaflet popups live outside the React tree.
function buildPopupContent(
  customer: Customer,
  getDirectionsLabel: string,
  onOpenDirections?: (customer: Customer) => void
) {
  const root = document.createElement("div")
  root.className = "space-y-1.5 text-sm"

  const name = document.createElement("div")
  name.className = "font-medium"
  name.textContent = customer.companyName || customer.fullName
  root.appendChild(name)

  if (customer.address) {
    const address = document.createElement("div")
    address.className = "text-xs text-muted-foreground"
    address.textContent = customer.address
    root.appendChild(address)
  }

  if (onOpenDirections) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = getDirectionsLabel
    button.className =
      "mt-1 inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
    button.addEventListener("click", () => onOpenDirections(customer))
    root.appendChild(button)
  }

  return root
}

// Member List's map companion (mirrors the old AppSheet list+map layout) — one
// pin per visible member, geocoded from their address via OpenStreetMap's
// Nominatim (free, no API key). Coordinates are cached on the customer row
// (see updateCustomerCoordinates) so a repeat visit only geocodes members
// that don't have a pin yet. Clicking a pin opens a popup with a "Get
// Directions" shortcut into the office-to-customer directions dialog; the
// search box above the map looks up any typed address, independent of the
// member list, via the same Nominatim proxy.
export function MemberMapPanel({
  customers,
  onOpenDirections,
}: {
  customers: Customer[]
  onOpenDirections?: (customer: Customer) => void
}) {
  const mapDivRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<L.Map | null>(null)
  const leafletRef = React.useRef<typeof L | null>(null)
  const markersRef = React.useRef<L.Marker[]>([])
  const searchMarkerRef = React.useRef<L.Marker | null>(null)
  const [ready, setReady] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searching, setSearching] = React.useState(false)
  const { t } = useTranslation("member")

  // Initialize the map once.
  React.useEffect(() => {
    let cancelled = false
    import("leaflet").then((mod) => {
      if (cancelled || !mapDivRef.current) return
      const leaflet = mod.default
      leafletRef.current = leaflet
      const map = leaflet.map(mapDivRef.current).setView(MANILA_CENTER, 11)
      leaflet.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
      mapRef.current = map
      setReady(true)
    })
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Place/update markers whenever the customer list changes.
  React.useEffect(() => {
    if (!ready) return
    const leaflet = leafletRef.current
    const map = mapRef.current
    if (!leaflet || !map) return

    let cancelled = false

    async function plotPins() {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      const bounds = leaflet!.latLngBounds([])
      let plotted = 0

      for (const customer of customers) {
        if (cancelled) return
        let lat = customer.latitude
        let lon = customer.longitude

        if ((lat === undefined || lon === undefined) && customer.address.trim()) {
          const geocoded = await geocodeAddress(customer.address)
          if (geocoded) {
            lat = geocoded.lat
            lon = geocoded.lon
            // Best-effort cache write — a rejected write just means this
            // member gets re-geocoded on the next visit, nothing to surface.
            updateCustomerCoordinates(customer.id, lat, lon).catch(() => {})
          }
          await sleep(NOMINATIM_MIN_INTERVAL_MS)
        }

        if (cancelled || lat === undefined || lon === undefined) continue

        const marker = leaflet!
          .marker([lat, lon], { icon: makePinIcon(leaflet!, "#2563eb") })
          .addTo(map!)
          .bindPopup(buildPopupContent(customer, t("getDirections"), onOpenDirections))
        markersRef.current.push(marker)
        bounds.extend([lat, lon])
        plotted++
      }

      if (!cancelled && plotted > 0) map!.fitBounds(bounds, { padding: [48, 48] })
    }

    plotPins()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, customers])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const query = searchQuery.trim()
    const leaflet = leafletRef.current
    const map = mapRef.current
    if (!query || !leaflet || !map) return

    setSearching(true)
    try {
      const result = await geocodeAddress(query)
      if (!result) {
        toast.error(t("addressNotFound"))
        return
      }
      searchMarkerRef.current?.remove()
      searchMarkerRef.current = leaflet
        .marker([result.lat, result.lon], { icon: makePinIcon(leaflet, "#9333ea") })
        .addTo(map)
        .bindPopup(query)
        .openPopup()
      map.setView([result.lat, result.lon], 15)
    } finally {
      setSearching(false)
    }
  }

  return (
    <Card className="flex h-[600px] flex-col">
      <CardHeader className="gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4 text-primary" /> {t("map")}
        </CardTitle>
        <form onSubmit={handleSearch} className="flex gap-1.5">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchAnyAddress")}
            className="h-8 text-sm"
          />
          <Button type="submit" size="icon" variant="outline" className="h-8 w-8 shrink-0" disabled={searching}>
            <Search className="h-3.5 w-3.5" />
          </Button>
        </form>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <div ref={mapDivRef} className="h-full w-full rounded-b-xl" />
      </CardContent>
    </Card>
  )
}
