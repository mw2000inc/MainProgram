import { NextResponse } from "next/server"
import { geocodeWithFallback } from "@/lib/nominatim-server"

// Vercel's plan-default serverless timeout (commonly ~10s) is too tight for
// the fallback chain in geocodeWithFallback, which can make up to 8 staggered
// (~1.1s apart) Nominatim requests for a single hard-to-parse address.
export const maxDuration = 30

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim()
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 })
  }

  const point = await geocodeWithFallback(address)
  if (!point) {
    return NextResponse.json({ error: "No match found for this address" }, { status: 404 })
  }
  return NextResponse.json(point)
}
