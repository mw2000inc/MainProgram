"use client"

import * as React from "react"
import { useAuth } from "@/lib/auth/auth-context"
import type { Locale } from "@/lib/types"
import enCommon from "@/lib/i18n/dictionaries/en/common.json"
import koCommon from "@/lib/i18n/dictionaries/ko/common.json"
import enNav from "@/lib/i18n/dictionaries/en/nav.json"
import koNav from "@/lib/i18n/dictionaries/ko/nav.json"
import enDataTable from "@/lib/i18n/dictionaries/en/dataTable.json"
import koDataTable from "@/lib/i18n/dictionaries/ko/dataTable.json"
import enStatus from "@/lib/i18n/dictionaries/en/status.json"
import koStatus from "@/lib/i18n/dictionaries/ko/status.json"
import enAuth from "@/lib/i18n/dictionaries/en/auth.json"
import koAuth from "@/lib/i18n/dictionaries/ko/auth.json"
import enFields from "@/lib/i18n/dictionaries/en/fields.json"
import koFields from "@/lib/i18n/dictionaries/ko/fields.json"
import enSchedule from "@/lib/i18n/dictionaries/en/schedule.json"
import koSchedule from "@/lib/i18n/dictionaries/ko/schedule.json"
import enAnnouncements from "@/lib/i18n/dictionaries/en/announcements.json"
import koAnnouncements from "@/lib/i18n/dictionaries/ko/announcements.json"
import enDispatch from "@/lib/i18n/dictionaries/en/dispatch.json"
import koDispatch from "@/lib/i18n/dictionaries/ko/dispatch.json"
import enFilterChange from "@/lib/i18n/dictionaries/en/filterChange.json"
import koFilterChange from "@/lib/i18n/dictionaries/ko/filterChange.json"
import enInstall from "@/lib/i18n/dictionaries/en/install.json"
import koInstall from "@/lib/i18n/dictionaries/ko/install.json"
import enRepair from "@/lib/i18n/dictionaries/en/repair.json"
import koRepair from "@/lib/i18n/dictionaries/ko/repair.json"
import enCollection from "@/lib/i18n/dictionaries/en/collection.json"
import koCollection from "@/lib/i18n/dictionaries/ko/collection.json"
import enSaleList from "@/lib/i18n/dictionaries/en/saleList.json"
import koSaleList from "@/lib/i18n/dictionaries/ko/saleList.json"
import enMember from "@/lib/i18n/dictionaries/en/member.json"
import koMember from "@/lib/i18n/dictionaries/ko/member.json"

// One namespace file per feature domain (see the phased build plan) — keeps
// 1,500+ eventual keys organized instead of one giant dictionary.
export type Namespace =
  | "common"
  | "nav"
  | "dataTable"
  | "status"
  | "auth"
  | "fields"
  | "schedule"
  | "announcements"
  | "dispatch"
  | "filterChange"
  | "install"
  | "repair"
  | "collection"
  | "saleList"
  | "member"

type Dictionary = Record<string, string>

const DICTIONARIES: Record<Locale, Record<Namespace, Dictionary>> = {
  en: {
    common: enCommon,
    nav: enNav,
    dataTable: enDataTable,
    status: enStatus,
    auth: enAuth,
    fields: enFields,
    schedule: enSchedule,
    announcements: enAnnouncements,
    dispatch: enDispatch,
    filterChange: enFilterChange,
    install: enInstall,
    repair: enRepair,
    collection: enCollection,
    saleList: enSaleList,
    member: enMember,
  },
  ko: {
    common: koCommon,
    nav: koNav,
    dataTable: koDataTable,
    status: koStatus,
    auth: koAuth,
    fields: koFields,
    schedule: koSchedule,
    announcements: koAnnouncements,
    dispatch: koDispatch,
    filterChange: koFilterChange,
    install: koInstall,
    repair: koRepair,
    collection: koCollection,
    saleList: koSaleList,
    member: koMember,
  },
}

const PRE_AUTH_LOCALE_KEY = "mw2000-locale"

function readPreAuthLocale(): Locale {
  try {
    const raw = window.localStorage.getItem(PRE_AUTH_LOCALE_KEY)
    if (raw === "en" || raw === "ko") return raw
  } catch {
    // localStorage can throw in some contexts (private browsing, blocked
    // storage) — fall through to the default rather than ever breaking the
    // page over a display preference.
  }
  return "en"
}

interface I18nContextValue {
  locale: Locale
  setPreAuthLocale: (locale: Locale) => void
}

const I18nContext = React.createContext<I18nContextValue>({ locale: "en", setPreAuthLocale: () => {} })

// Locale comes from the signed-in user's own profile (profiles.locale) once
// one exists. Before that — the login page, or any instant before the
// session loads — there's no profile to read, so a separate, localStorage-
// backed "pre-auth" locale takes over instead (its own toggle lives on the
// login page itself; see LoginPage). The two are deliberately independent:
// picking a language before signing in does not yet carry over to a new
// account's synced preference after signup (that would mean teaching
// handle_new_user() about it too, a DB change out of this phase's scope) —
// flagged as a known gap, not silently solved here.
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  // Starts at the default on every render (server and client alike) to
  // avoid a hydration mismatch — localStorage doesn't exist on the server —
  // then synced from the real stored value below, after mount, same pattern
  // as the login page's own pre-existing "remembered email" read.
  const [preAuthLocale, setPreAuthLocaleState] = React.useState<Locale>("en")

  React.useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreAuthLocaleState(readPreAuthLocale())
    }
  }, [user])

  const setPreAuthLocale = React.useCallback((next: Locale) => {
    setPreAuthLocaleState(next)
    try {
      window.localStorage.setItem(PRE_AUTH_LOCALE_KEY, next)
    } catch {
      // Same as readPreAuthLocale — never let a storage failure break the
      // UI, it just won't persist across a reload.
    }
  }, [])

  const locale = user?.locale ?? preAuthLocale
  const value = React.useMemo(() => ({ locale, setPreAuthLocale }), [locale, setPreAuthLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// t(key, params) looks up `key` in `namespace` for the current locale,
// falling back to English when a Korean key hasn't been translated yet
// (expected for most of the app throughout the phased rollout — see the
// plan), and finally to the raw key itself if it's missing from both
// dictionaries, so a typo'd key reads oddly rather than crashing the page.
// params does simple {placeholder} substitution for dynamic strings (e.g.
// "Showing {start}-{end} of {total}") — deliberately not full ICU
// pluralization/formatting, which this app doesn't need yet.
export function useTranslation(namespace: Namespace) {
  const { locale } = React.useContext(I18nContext)
  const t = React.useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const template = DICTIONARIES[locale]?.[namespace]?.[key] ?? DICTIONARIES.en[namespace]?.[key] ?? key
      if (!params) return template
      return Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), template)
    },
    [locale, namespace]
  )
  return { t, locale }
}

// The login page's own language toggle — the only place a pre-auth locale
// can be set at all, since it's the only unauthenticated page covered by
// this phase (see the plan's Phase 4 for /confirm and /portal). A no-op,
// by design, once signed in — setPreAuthLocale still updates localStorage,
// it just no longer affects `locale` above, which prefers user.locale from
// that point on.
export function usePreAuthLocale() {
  const { locale, setPreAuthLocale } = React.useContext(I18nContext)
  return { locale, setLocale: setPreAuthLocale }
}
