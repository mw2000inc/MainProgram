"use client"

import * as React from "react"
import { MapPin, MessageSquare, Navigation, Phone } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn } from "@/lib/utils"

// Tap-friendly contact actions for a job or member: the address opens turn-by-
// turn directions, a phone number offers Call or Text. Used on the
// technician's schedule (agenda) and the Customer Details pop-up.

// Every phone number in a contact field — the field is free text and can hold
// several ("09457338000 / 09558378882") or a name with it ("Richard Jarabe -
// 86712049 collection"). Digits (and a leading +) only; 7+ digits to count.
export function phoneNumbersIn(text: string | null | undefined): string[] {
  const found = (text ?? "").match(/\+?\d[\d\s().-]{5,}\d/g) ?? []
  const numbers = found.map((n) => n.replace(/(?!^\+)[^\d]/g, "")).filter((n) => n.replace(/\D/g, "").length >= 7)
  return [...new Set(numbers)]
}

// Google Maps directions from wherever the phone is (no origin = the current
// location) to the job: its saved map point when it has one, else the address.
export function directionsUrl(address?: string, latitude?: number, longitude?: number): string | undefined {
  const destination = latitude != null && longitude != null ? `${latitude},${longitude}` : (address ?? "").trim()
  if (!destination) return undefined
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

// Clicks here never reach the row/card underneath (which may open a detail
// view or start a drag).
const stop = (e: React.SyntheticEvent) => e.stopPropagation()

export function DirectionsLink({
  address,
  latitude,
  longitude,
  className,
  iconClassName,
}: {
  address: string
  latitude?: number
  longitude?: number
  className?: string
  iconClassName?: string
}) {
  const { t } = useTranslation("common")
  const href = directionsUrl(address, latitude, longitude)
  if (!href) return <span className={className}>{address}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={stop}
      onPointerDown={stop}
      title={t("contactDirections")}
      className={cn("inline-flex items-start gap-1 hover:text-foreground hover:underline", className)}
      data-testid="contact-directions"
    >
      <MapPin className={cn("mt-0.5 h-3 w-3 shrink-0", iconClassName)} />
      <span>{address}</span>
      <Navigation className={cn("mt-0.5 h-3 w-3 shrink-0 opacity-60", iconClassName)} aria-hidden />
    </a>
  )
}

// The contact field as written; tapping it opens Call / Text for each number
// in it. With no number in it, just the text.
export function PhoneActions({ value, className, iconClassName }: { value: string; className?: string; iconClassName?: string }) {
  const { t } = useTranslation("common")
  const numbers = phoneNumbersIn(value)
  if (numbers.length === 0) {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        <Phone className={cn("h-3 w-3 shrink-0", iconClassName)} /> {value}
      </span>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stop}
          onPointerDown={stop}
          className={cn("inline-flex items-center gap-1 text-left hover:text-foreground hover:underline", className)}
          aria-label={t("contactPhoneOptions", { number: value })}
          data-testid="contact-phone"
        >
          <Phone className={cn("h-3 w-3 shrink-0", iconClassName)} />
          <span>{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-2" onClick={stop} onPointerDown={stop} data-testid="contact-phone-menu">
        {numbers.map((n) => (
          <div key={n} className="space-y-1.5">
            {numbers.length > 1 && <p className="px-1 text-xs font-medium text-muted-foreground">{n}</p>}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={`tel:${n}`}
                className="inline-flex h-[44px] items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                data-testid="contact-call"
              >
                <Phone className="h-4 w-4" /> {t("contactCall")}
              </a>
              <a
                href={`sms:${n}`}
                className="inline-flex h-[44px] items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
                data-testid="contact-text"
              >
                <MessageSquare className="h-4 w-4" /> {t("contactText")}
              </a>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
