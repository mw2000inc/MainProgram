"use client"

import { useTranslation, type Namespace } from "@/lib/i18n/i18n-context"

// A ColumnDef's `header` can be a function (TanStack Table renders it via
// flexRender, exactly like a cell) — this is what lets a static column-def
// array (built outside any component, so it can't call hooks directly) show
// a translated header: pass `header: () => <ColumnHeader tKey="..." ns="..." />`
// instead of a literal string.
export function ColumnHeader({ tKey, ns }: { tKey: string; ns: Namespace }) {
  const { t } = useTranslation(ns)
  return <>{t(tKey)}</>
}
