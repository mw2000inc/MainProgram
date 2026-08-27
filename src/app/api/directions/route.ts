import { NextResponse } from "next/server"
import { geocodeWithFallback, peekGeocodeCache, type GeoPoint } from "@/lib/nominatim-server"

// This route can geocode up to two addresses sequentially (fewer once a
// caller passes already-known coordinates for one or both — see originLat/
// originLon/destinationLat/destinationLon below), each of which can itself
// make up to 8 staggered (~1.1s apart) Nominatim requests via the fallback
// chain in nominatim-server.ts — worst case comfortably exceeds Vercel's
// plan-default serverless timeout (commonly ~10s).
export const maxDuration = 30

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parsedPoint(latStr: string | null, lonStr: string | null): GeoPoint | null {
  if (!latStr || !lonStr) return null
  const lat = Number(latStr)
  const lon = Number(lonStr)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon }
}

// Geocodes both addresses (via Nominatim, with the fallback/cleanup strategy
// in nominatim-server.ts — skipped for either side a caller already has
// cached coordinates for, e.g. the office address in company_settings or a
// member's own customers.latitude/longitude) then asks OSRM's free public
// demo router for a driving route between them — both no-key, no-billing
// services.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const originAddress = params.get("origin")?.trim()
  const destinationAddress = params.get("destination")?.trim()
  const knownOrigin = parsedPoint(params.get("originLat"), params.get("originLon"))
  const knownDestination = parsedPoint(params.get("destinationLat"), params.get("destinationLon"))
  if ((!originAddress && !knownOrigin) || (!destinationAddress && !knownDestination)) {
    return NextResponse.json({ error: "origin and destination are required" }, { status: 400 })
  }

  const originWasCached = !knownOrigin && !!originAddress && !!peekGeocodeCache(originAddress)
  const origin = knownOrigin ?? (originAddress ? await geocodeWithFallback(originAddress) : null)
  if (!origin) {
    return NextResponse.json({ error: "Could not locate the office address" }, { status: 404 })
  }
  // Nominatim's usage policy caps requests at ~1/second — stagger the two
  // geocode lookups this route makes, unless neither actually hit Nominatim
  // (already-known coordinates, or an already-cached address) — nothing was
  // sent, so there's nothing to space out.
  if (!knownOrigin && !originWasCached) await sleep(1100)
  const destination = knownDestination ?? (destinationAddress ? await geocodeWithFallback(destinationAddress) : null)
  if (!destination) {
    return NextResponse.json({ error: "Could not locate the member's address" }, { status: 404 })
  }

  const routeUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson`
  const routeRes = await fetch(routeUrl)
  if (!routeRes.ok) {
    return NextResponse.json({ error: "Routing request failed" }, { status: 502 })
  }
  const routeData = (await routeRes.json()) as {
    code: string
    routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[]
  }
  if (routeData.code !== "Ok" || !routeData.routes?.length) {
    return NextResponse.json({ error: "No driving route found between these addresses" }, { status: 404 })
  }

  const route = routeData.routes[0]
  return NextResponse.json({
    origin,
    destination,
    geometry: route.geometry.coordinates,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  })
}
