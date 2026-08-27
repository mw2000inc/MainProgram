// Centralizes how a C/T value maps to a number of months — the single
// source of truth for both the Sale List's CP End auto-calculation
// (sale-list-form-dialog.tsx) and the Collection Plan's recurring
// collection schedule (see the collection_schedule migration), so the two
// can never drift apart the way they used to (the original CP End
// calculator had its own inline switch that only recognized the exact
// strings "Monthly"/"Quarterly"/"Half Year").
//
// C/T is a free-typed combobox (see CT_OPTIONS in sale-list-form-dialog.tsx),
// not a fixed enum — real production data already contains both full words
// ("Quarterly", "Yearly") and single-letter shorthand ("Q", "Y"), so this
// recognizes both, case-insensitively. Anything unrecognized falls back to
// 12 months (Yearly), matching the original calculator's own
// default-to-one-year behavior for a blank/unset/custom C/T.
//
// IMPORTANT: ct_interval_months() in the collection_schedule migration is a
// SQL mirror of this exact mapping (a Postgres trigger can't call TS code) —
// keep the two in sync if this mapping ever changes.
export function ctIntervalMonths(ct: string | undefined): number {
  const normalized = (ct ?? "").trim().toLowerCase()
  if (normalized === "monthly" || normalized === "m") return 1
  if (normalized === "quarterly" || normalized === "q") return 3
  if (
    normalized === "half year" ||
    normalized === "halfyear" ||
    normalized === "h" ||
    normalized === "semi-annual" ||
    normalized === "semiannual"
  ) {
    return 6
  }
  return 12
}
