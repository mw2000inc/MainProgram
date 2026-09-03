import type { Locale } from "@/lib/types"

// Cheap heuristic for which of this app's two supported languages a piece
// of text is already in — this app only ever has English and Korean
// content, so "contains Hangul" is a reliable enough signal without
// spending a translation-API call on language detection. Shared between
// the server (deciding whether to skip a DeepL call — see
// deepl-server.ts) and the client (deciding whether to even show a "View
// translation" toggle at all — see TranslatableText).
export function looksLikeKorean(text: string): boolean {
  return /[가-힣]/.test(text)
}

export function alreadyInTargetLocale(text: string, targetLocale: Locale): boolean {
  return looksLikeKorean(text) === (targetLocale === "ko")
}
