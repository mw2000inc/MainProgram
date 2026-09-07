import { z } from "zod"

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
