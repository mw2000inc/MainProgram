import { z } from "zod"
import { isValid, parseISO } from "date-fns"

// Shared by every Add/Edit form with a currency/payment amount field —
// deduplicates what used to be four near-identical z.string().refine(...)
// validators, copy-pasted with the same logic each time (Repair's amt,
// Install's unitPrice/cpPrice/deliveryInstallationFee, Collections' amount,
// Inventory's purchasePrice/sellingPrice). Value is kept as a plain string
// in form state rather than z.number() — CurrencyInput (see
// components/shared/currency-input.tsx) needs a plain editable string to
// format on blur, and every one of these forms already converts to a real
// number only at submit time (`Number(values.amount)` etc.), same as
// before this was factored out.
//
// Most of these fields allow "" (left blank, defaults to 0 on submit);
// pass `requiredField` for the one case that doesn't — Collections' Amount
// is a required field, not just a non-negative one.
export function moneySchema(
  t: (key: string, params?: Record<string, string>) => string,
  requiredField?: string
) {
  const schema = z
    .string()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), t("mustBeZeroOrMore"))
  return requiredField ? schema.refine((v) => v.trim() !== "", t("requiredField", { field: requiredField })) : schema
}

// A wide but finite acceptable year range for any plain date field this app
// collects — not a business rule, just a sanity backstop. Every date field
// across these forms currently only checks z.string().min(1, ...) (or
// nothing, if optional), which accepts literally any string a native
// <input type="date"> can produce — including a still-incomplete year (a
// single digit before the rest is typed), a 5+-digit one, or a shape like
// "2026-02-30" that parses as a *string* fine but isn't a real calendar
// date. Those values don't fail validation today; they go on to crash
// whatever later tries to *display* them (date-fns' format() throws on an
// Invalid Date rather than returning something — see safeFormat's own
// comment in utils.ts, the fix for that half of this). This is the other
// half: catching the same class of value at submit time instead of letting
// it reach the database at all.
const MIN_REASONABLE_YEAR = 1900
const MAX_REASONABLE_YEAR = 2100

export function isReasonableDateString(value: string): boolean {
  if (!value) return true // "required" is min(1, ...)'s own concern, not this one's
  const d = parseISO(value)
  return isValid(d) && d.getFullYear() >= MIN_REASONABLE_YEAR && d.getFullYear() <= MAX_REASONABLE_YEAR
}

// Shared by every Add/Edit form with a plain yyyy-MM-dd date field — same
// optional-vs-required shape as moneySchema above (pass `requiredField` for
// a date that must be filled in, omit it for one that doesn't).
export function dateFieldSchema(
  t: (key: string, params?: Record<string, string>) => string,
  requiredField?: string
) {
  const schema = z.string().refine(isReasonableDateString, t("invalidDate"))
  return requiredField ? schema.refine((v) => v.trim() !== "", t("requiredField", { field: requiredField })) : schema
}
