import { useQuery } from "@tanstack/react-query"
import { translateContent, type TranslateContentInput } from "@/lib/api/translations"

// Query-based (not a mutation) specifically so react-query's own cache
// does the "don't re-fetch what's already been revealed" work for free —
// keyed on the source text itself (not just the entity/field), so an
// edit to the original note naturally gets a fresh translation instead
// of silently reusing a stale client-side result (same invalidation
// idea as the server's own source_hash, just mirrored on this side).
// `input` is null until the viewer actually asks to see a translation
// (see TranslatableText) — `enabled` gates the query on that, so opening
// a page full of notes never eagerly translates anything nobody asked
// to read translated.
export function useContentTranslation(input: TranslateContentInput | null) {
  return useQuery({
    queryKey: [
      "contentTranslation",
      input?.entityType,
      input?.entityId,
      input?.fieldName,
      input?.targetLocale,
      input?.text,
    ],
    queryFn: () => translateContent(input!),
    enabled: !!input && input.text.trim().length > 0,
    staleTime: Infinity,
    retry: false,
  })
}
