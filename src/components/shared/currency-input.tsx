"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/lib/utils"

// Shared currency/payment amount input — used by every Add/Edit form with
// a peso amount (Collections, Repair, Install, Inventory, Sale List's C/F).
//
// A native <input type="number"> can never show a "₱" prefix or comma
// thousands-separators — browsers restrict that input type to digits,
// a decimal point, and a minus sign, full stop. So this is a plain text
// input instead (inputMode="decimal" for a numeric mobile keyboard), with
// format-on-blur rather than live-as-you-type: while the field is focused
// it shows/accepts the raw editable number (auto-selected on focus, same
// convention as this app's other numeric inputs), and reformats to
// "₱X,XXX.XX" — via the exact same formatCurrency() used everywhere this
// value is displayed — the moment it loses focus. True live-as-you-type
// comma insertion means constantly repositioning the caret around commas
// that appear/disappear mid-keystroke, a well-known source of finicky
// cursor bugs; format-on-blur gets the same end result (every payment
// field reads with ₱/commas once the admin's done with it) at much lower
// implementation and testing risk.
//
// Value is always a plain string ("", "3920", "3920.5") — never a number —
// matching moneySchema (form-schemas.ts) and how every one of these forms
// already converts to a real number only at submit time.
export function CurrencyInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  disabled,
  name,
  "aria-invalid": ariaInvalid,
}: {
  value: string
  onChange: (next: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  disabled?: boolean
  name?: string
  "aria-invalid"?: boolean
}) {
  const [focused, setFocused] = React.useState(false)

  return (
    <Input
      type="text"
      inputMode="decimal"
      name={name}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      aria-invalid={ariaInvalid}
      value={focused ? value : formatForDisplay(value)}
      onFocus={(e) => {
        setFocused(true)
        e.target.select()
      }}
      onBlur={() => {
        setFocused(false)
        onBlur?.()
      }}
      onChange={(e) => onChange(sanitizeMoneyInput(e.target.value))}
    />
  )
}

// Strips anything but digits and a single decimal point as the admin
// types — the same constraint a native type="number" input already
// enforces on its own, necessary to reimplement here since this has to be
// type="text" to ever show "₱"/commas once the field blurs.
function sanitizeMoneyInput(raw: string): string {
  const digitsAndDot = raw.replace(/[^0-9.]/g, "")
  const firstDot = digitsAndDot.indexOf(".")
  if (firstDot === -1) return digitsAndDot
  return digitsAndDot.slice(0, firstDot + 1) + digitsAndDot.slice(firstDot + 1).replace(/\./g, "")
}

function formatForDisplay(value: string): string {
  if (value.trim() === "") return ""
  const num = Number(value)
  if (Number.isNaN(num)) return value
  return formatCurrency(num)
}
