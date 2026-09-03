"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { useUpdateMyLocale } from "@/lib/hooks/use-misc"
import type { Locale } from "@/lib/types"

// Everyone's own preference, not an admin-only setting — synced via
// profiles.locale (see the profile_locale migration), so it follows a
// person across devices. Deliberately visible to every signed-in user, not
// just admins: see SettingsPage's own comment on why this one card sits
// outside the rest of the page's admin gate.
export function LanguagePanel() {
  const { t, locale } = useTranslation("common")
  const updateLocale = useUpdateMyLocale()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("language")}</CardTitle>
        <CardDescription>{t("languageDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Select value={locale} onValueChange={(v) => updateLocale.mutate(v as Locale)}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">{t("english")}</SelectItem>
            <SelectItem value="ko">{t("korean")}</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}
