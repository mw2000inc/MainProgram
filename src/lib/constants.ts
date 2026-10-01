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

// The crew a vehicle always goes out with. Picking one of these vehicles in
// the Schedule form or the Schedule table fills in both technicians (still
// changeable afterwards) — see crewForVehicle in lib/technicians.ts.
export const VEHICLE_CREWS: Partial<Record<string, readonly [string, string]>> = {
  Liteace: ["Eubert Montalbo", "Jayson Sapitin"],
}

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
// locked Select, so this isn't the same vocabulary just reused. "Bank" is
// kept as-is (not renamed to PAYMENT_METHODS' own "Bank Transfer" wording)
// even though a later request described this list using that phrase —
// renaming would silently orphan every already-stored "Bank" value from
// existing rows, which a wording tweak isn't worth risking; PDC (Post-Dated
// Check) added alongside it as its own new value instead.
export const COLLECTION_PAYMENT_TYPES = ["GCash", "Card", "Bank", "Cash", "Check", "PDC"] as const

// Where a collections payment actually ended up once received — the
// Collection Details breakdown dialog's own "Deposited Fund" column
// (collection_breakdown_fields migration, WB added by
// 20261010000000_deposited_fund_add_wb.sql). COH = Cash on Hand (not yet
// deposited anywhere); the rest are named bank/e-wallet destinations this
// company actually deposits into.
export const DEPOSITED_FUND_OPTIONS = ["COH", "GCash", "MB", "EW", "BDO", "WB"] as const

export const PAYMENT_STATUSES = ["Paid", "Pending", "Overdue", "Partial"] as const

export const STOCK_MOVEMENT_REASONS = ["Restock", "Return", "Damaged", "Adjustment"] as const

// Written only by triggers (the sale-item trigger, the filter-change
// deduction, the repair-part deduction — see their own migrations), never
// offered as a Select option in the Stock Movement form. Every stock
// movement's reason is one of these three OR one of STOCK_MOVEMENT_REASONS
// above — the two sets are mutually exclusive and, together, exhaustive of
// every reason this app has ever written — so a row's own reason value
// already tells you whether an admin typed it in directly (see
// useStockMovementRows' own `source` field, which is exactly this check).
export const AUTOMATED_STOCK_MOVEMENT_REASONS = ["Sale", "Filter Change", "Repair", "Installation"] as const

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
