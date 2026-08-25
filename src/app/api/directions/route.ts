import { NextResponse } from "next/server"
import { geocodeWithFallback, peekGeocodeCache } from "@/lib/nominatim-server"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Geocodes both addresses (via Nominatim, with the fallback/cleanup strategy
// in nominatim-server.ts) then asks OSRM's free public demo router for a
// driving route between them — both no-key, no-billing services.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const originAddress = params.get("origin")?.trim()
  const destinationAddress = params.get("destination")?.trim()
  if (!originAddress || !destinationAddress) {
    return NextResponse.json({ error: "origin and destination are required" }, { status: 400 })
  }

  const originWasCached = !!peekGeocodeCache(originAddress)
  const origin = await geocodeWithFallback(originAddress)
  if (!origin) {
    return NextResponse.json({ error: "Could not locate the office address" }, { status: 404 })
  }
  // Nominatim's usage policy caps requests at ~1/second — stagger the two
  // geocode lookups this route makes, unless the origin was already cached
  // (nothing was actually sent to Nominatim, so there's nothing to space out).
  if (!originWasCached) await sleep(1100)
  const destination = await geocodeWithFallback(destinationAddress)
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
