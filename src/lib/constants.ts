export const DISPENSER_TYPES = [
  "SK2 White",
  "SK2 Purple",
  "SK2 Black",
  "SK2 Pink",
] as const

export const TECHNICIANS = [
  "Joselito Compereso",
  "Jerson Capellon",
  "Jayson Sapitin",
  "Eubert Montalbo",
  "Jeric Salirio",
  "Mell",
  "Butch",
  "Pritz",
  "N/A",
] as const

// The actual company fleet, for a schedule_jobs row's own `vehicle` column
// — plain text under the hood (not a DB enum), so a specific plate or
// older label typed in some other way still displays fine; this is only
// the quick-select list the Schedule form's own dropdown offers, same
// relationship TECHNICIANS above has to that free-text column. "None" is
// deliberately not a list entry here — the form's own NONE_SENTINEL option
// already covers "unassigned" by clearing the field to "", rather than
// storing the literal string "None" as if it were a real vehicle.
export const VEHICLE_TYPES = ["Aerox Black", "Aerox Blue", "PCX", "Almera", "Liteace"] as const

export const PRODUCT_CATEGORIES = [
  "Purifiers",
  "Filters",
  "Accessories",
] as const

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Credit Card", "GCash", "Check"] as const

// Collections' own Payment Type presets — deliberately a separate list from
// PAYMENT_METHODS above (Install's own Payment Mode field): different
// wording ("Card"/"Bank" vs. "Credit Card"/"Bank Transfer"), different
// field, offered via a typable Combobox rather than PAYMENT_METHODS' own
// locked Select, so this isn't the same vocabulary just reused.
export const COLLECTION_PAYMENT_TYPES = ["GCash", "Card", "Bank", "Cash", "Check"] as const

export const PAYMENT_STATUSES = ["Paid", "Pending", "Overdue", "Partial"] as const

export const STOCK_MOVEMENT_REASONS = ["Restock", "Return", "Damaged", "Adjustment"] as const

// The old AppSheet system's fixed product catalog, grouped by brand prefix —
// used by the Sale List entry form's Product# dropdown. `name` is stored
// exactly as it appeared there (some already prefixed with "BRAND) ", some
// not — e.g. KS items are plain "NK-45") so the combined "code / name" value
// matches the format already used everywhere else in the app (e.g. the
// existing "101 / MW) F7" placeholder text).
export const PRODUCT_CATALOG: { group: string; items: { code: string; name: string }[] }[] = [
  {
    group: "MW",
    items: [
      { code: "101", name: "MW) F7" },
      { code: "102", name: "MW) F5" },
      { code: "103", name: "MW) Hercules" },
      { code: "104", name: "MW) Mellon" },
      { code: "105", name: "MW) Oasis-T1" },
      { code: "106", name: "MW) Oasis-S2" },
      { code: "107", name: "MW) Oasis-T2" },
      { code: "108", name: "MW) Oasis-S1" },
    ],
  },
  {
    group: "SK",
    items: [
      { code: "201-BK", name: "SK) Standard K (black)" },
      { code: "201-WT", name: "SK) Standard K (white)" },
    ],
  },
  {
    group: "AW",
    items: [
      { code: "401", name: "AW) ANYWATER HK-05 (Small)" },
      { code: "402", name: "AW) ANYWATER HK-05 (Medium)" },
      { code: "403", name: "AW) ANYWATER HK-05 (Large)" },
      { code: "404", name: "AW) Big Faucet" },
    ],
  },
  {
    group: "KS",
    items: [
      { code: "501", name: "NK-45" },
      { code: "502", name: "NK-63" },
      { code: "503", name: "NK-121" },
      { code: "504", name: "VK390A" },
    ],
  },
  {
    group: "PR",
    items: [{ code: "600", name: "PR) Pureal DIY" }],
  },
  {
    group: "PT",
    items: [
      { code: "1151", name: "Pre-Filtration Housing Package (1 stage)" },
      { code: "1173", name: "Pre-filtration Housing Package (4 stages)" },
      { code: "1174", name: "Pre-filtration Housing Package (2 stages) 3/4\"" },
    ],
  },
]

export function formatProductOption(code: string, name: string): string {
  return `${code} / ${name}`
}
