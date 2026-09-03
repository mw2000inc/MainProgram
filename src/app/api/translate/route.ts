import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { translateText } from "@/lib/deepl-server"
import { alreadyInTargetLocale } from "@/lib/locale-detect"
import type { Locale } from "@/lib/types"

export const dynamic = "force-dynamic"

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

// On-demand ("on-read") translation of a piece of live user-authored
// content — Notes fields, Announcement bodies, comment bodies — with a
// shared cache (content_translations) keyed by (entityType, entityId,
// fieldName, locale), invalidated automatically whenever the source text
// changes (its hash no longer matches the cached row's). See the
// content_translations migration's own comment for why this is one
// generic table rather than a column on every Notes-bearing table.
//
// Any signed-in user (admin or technician) can call this — translating
// content the caller can already see isn't a privileged action, and the
// cache itself is shared, not per-user (see the migration's RLS).
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    entityType?: string
    entityId?: string
    fieldName?: string
    text?: string
    targetLocale?: Locale
  } | null
  const { entityType, entityId, fieldName, text, targetLocale } = body ?? {}
  if (!entityType || !entityId || !fieldName || !text || !targetLocale) {
    return NextResponse.json(
      { error: "entityType, entityId, fieldName, text, and targetLocale are all required" },
      { status: 400 }
    )
  }
  if (targetLocale !== "en" && targetLocale !== "ko") {
    return NextResponse.json({ error: "targetLocale must be 'en' or 'ko'" }, { status: 400 })
  }

  // Nothing to translate — the text is empty, or already reads as the
  // target language (see alreadyInTargetLocale's own comment) — hand the
  // original straight back rather than spending a DeepL call on it.
  if (!text.trim() || alreadyInTargetLocale(text, targetLocale)) {
    return NextResponse.json({ translatedText: text, cached: false, skipped: true })
  }

  const sourceHash = hashText(text)

  const { data: cachedRow } = await supabase
    .from("content_translations")
    .select("translated_text, source_hash")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("field_name", fieldName)
    .eq("locale", targetLocale)
    .maybeSingle()

  if (cachedRow && cachedRow.source_hash === sourceHash) {
    return NextResponse.json({ translatedText: cachedRow.translated_text, cached: true })
  }

  let result
  try {
    result = await translateText(text, targetLocale)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Translation request failed" },
      { status: 502 }
    )
  }
  if (!result) {
    return NextResponse.json({ error: "Translation is not configured yet (DEEPL_API_KEY not set)" }, { status: 503 })
  }

  const { error: upsertError } = await supabase.from("content_translations").upsert(
    {
      entity_type: entityType,
      entity_id: entityId,
      field_name: fieldName,
      locale: targetLocale,
      source_hash: sourceHash,
      translated_text: result.translatedText,
    },
    { onConflict: "entity_type,entity_id,field_name,locale" }
  )
  // A failed cache write isn't a failed translation — the caller still
  // gets today's result, just without it being saved for next time.
  if (upsertError) {
    console.error("Failed to cache translation:", upsertError)
  }

  return NextResponse.json({ translatedText: result.translatedText, cached: false })
}
