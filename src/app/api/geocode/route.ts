import { NextResponse } from "next/server"
import { geocodeWithFallback } from "@/lib/nominatim-server"

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
