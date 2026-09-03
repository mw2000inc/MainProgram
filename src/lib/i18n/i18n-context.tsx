"use client"

import * as React from "react"
import { useAuth } from "@/lib/auth/auth-context"
import type { Locale } from "@/lib/types"
import enCommon from "@/lib/i18n/dictionaries/en/common.json"
import koCommon from "@/lib/i18n/dictionaries/ko/common.json"

// One namespace file per feature domain (see the phased build plan) — keeps
// 1,500+ eventual keys organized instead of one giant dictionary. "common"
// is the only one Phase 0 seeds; later phases add "filterChange",
// "saleList", "dispatch", etc. the same way.
export type Namespace = "common"

type Dictionary = Record<string, string>

const DICTIONARIES: Record<Locale, Record<Namespace, Dictionary>> = {
  en: { common: enCommon },
  ko: { common: koCommon },
}

interface I18nContextValue {
  locale: Locale
}

const I18nContext = React.createContext<I18nContextValue>({ locale: "en" })

// Locale comes from the signed-in user's own profile (profiles.locale) --
// there's no unauthenticated default beyond the context's own "en" fallback
// above, which only matters before a session loads (see AuthProvider's own
// loading state) or on pages rendered outside it entirely (e.g. /login,
// /confirm/[token]) — see the phased plan's Phase 4 for when those get their
// own translation coverage.
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const locale = user?.locale ?? "en"
  const value = React.useMemo(() => ({ locale }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// t(key) looks up `key` in `namespace` for the current locale, falling back
// to English when a Korean key hasn't been translated yet (expected for
// most of the app throughout the phased rollout — see the plan), and
// finally to the raw key itself if it's missing from both dictionaries, so
// a typo'd key reads oddly rather than crashing the page.
export function useTranslation(namespace: Namespace) {
  const { locale } = React.useContext(I18nContext)
  const t = React.useCallback(
    (key: string) => DICTIONARIES[locale]?.[namespace]?.[key] ?? DICTIONARIES.en[namespace]?.[key] ?? key,
    [locale, namespace]
  )
  return { t, locale }
}
