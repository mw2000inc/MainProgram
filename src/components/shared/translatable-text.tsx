"use client"

import * as React from "react"
import { Languages, Loader2 } from "lucide-react"
import { useContentTranslation } from "@/lib/hooks/use-translations"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { alreadyInTargetLocale } from "@/lib/locale-detect"
import { cn } from "@/lib/utils"

// Wraps one piece of live user-authored text (a Note, an Announcement
// body, a comment) with an optional on-demand translation — the original
// is always rendered as-is; a "View translation" toggle reveals a
// translated copy alongside it, underneath, never replacing it (per the
// explicit "original always shown" requirement for this phase). No
// toggle is shown at all when the text already looks like it's in the
// viewer's own interface language (see alreadyInTargetLocale) — nothing
// useful to offer there.
//
// entityType/entityId/fieldName identify the source row+column for the
// server's content_translations cache (see /api/translate) — entityType
// should be the actual table name (e.g. "customers", "announcements"),
// entityId that row's id, fieldName the column (e.g. "notes", "body").
export function TranslatableText({
  entityType,
  entityId,
  fieldName,
  text,
  className,
  translatedClassName,
}: {
  entityType: string
  entityId: string
  fieldName: string
  text: string
  className?: string
  translatedClassName?: string
}) {
  const { t, locale } = useTranslation("common")
  const [revealed, setRevealed] = React.useState(false)
  const { data: translatedText, isFetching, isError, error } = useContentTranslation(
    revealed ? { entityType, entityId, fieldName, text, targetLocale: locale } : null
  )
  const notConfigured = error instanceof Error && error.message.includes("not configured")

  const showToggle = text.trim().length > 0 && !alreadyInTargetLocale(text, locale)

  return (
    <>
      <p className={className}>{text}</p>
      {showToggle && (
        <>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setRevealed((v) => !v)}
          >
            <Languages className="h-3 w-3" />
            {revealed ? t("hideTranslation") : t("viewTranslation")}
          </button>
          {revealed && (
            <div className={cn("mt-1 rounded-md border border-dashed bg-muted/30 px-2 py-1.5", translatedClassName)}>
              {isFetching && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t("translating")}
                </p>
              )}
              {isError && (
                <p className="text-xs text-destructive">
                  {notConfigured ? t("translationUnavailable") : t("translationFailed")}
                </p>
              )}
              {!isFetching && !isError && translatedText && (
                <p className="text-sm whitespace-pre-wrap">{translatedText}</p>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
