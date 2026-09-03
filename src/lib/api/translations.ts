import type { Locale } from "@/lib/types"

export interface TranslateContentInput {
  entityType: string
  entityId: string
  fieldName: string
  text: string
  targetLocale: Locale
}

// Hits /api/translate (not the DB directly) since translating requires
// the server-only DEEPL_API_KEY — see that route's own comment for the
// on-demand-with-cache design (content_translations).
export async function translateContent(input: TranslateContentInput): Promise<string> {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? "Failed to translate")
  return data.translatedText as string
}
