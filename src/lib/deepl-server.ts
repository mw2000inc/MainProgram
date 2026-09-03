// Server-only DeepL (https://www.deepl.com) wrapper for on-demand
// translation of live user-authored content (Notes, Announcements,
// comments) — see /api/translate. DEEPL_API_KEY required; missing it is
// treated as "not configured yet" (returns null), not an error, same
// convention as sendEmail/sendSms in dispatch-notifications-server.ts.
import type { Locale } from "@/lib/types"

// A free-tier key always ends in ":fx" and only works against the free
// API host — a Pro key has no suffix and only works against the Pro
// host. Picking the wrong host for a given key fails outright, so this
// is derived from the key itself rather than a separate env var to
// configure.
function apiHost(apiKey: string): string {
  return apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com"
}

const TARGET_LANG: Record<Locale, string> = {
  en: "EN-US",
  ko: "KO",
}

export interface TranslateResult {
  translatedText: string
  detectedSourceLanguage: string
}

export async function translateText(text: string, targetLocale: Locale): Promise<TranslateResult | null> {
  const apiKey = process.env.DEEPL_API_KEY
  if (!apiKey) return null

  const response = await fetch(`${apiHost(apiKey)}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [text],
      target_lang: TARGET_LANG[targetLocale],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`DeepL request failed (${response.status}): ${detail || response.statusText}`)
  }

  const data = (await response.json()) as {
    translations?: { text: string; detected_source_language: string }[]
  }
  const first = data.translations?.[0]
  if (!first) throw new Error("DeepL response had no translation")

  return { translatedText: first.text, detectedSourceLanguage: first.detected_source_language }
}
