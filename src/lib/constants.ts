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
  "Jason Pabalan",
  "Jeric Salirio",
  "N/A",
] as const

export const PRODUCT_CATEGORIES = [
  "Purifiers",
  "Filters",
  "Accessories",
] as const

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Credit Card", "GCash", "Check"] as const

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
    items: [{ code: "1151", name: "Pre-Filtration Housing Package (1 stage)" }],
  },
]

export function formatProductOption(code: string, name: string): string {
  return `${code} / ${name}`
}
