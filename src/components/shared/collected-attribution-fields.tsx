"use client"

import * as React from "react"
import type { Control, FieldValues, Path } from "react-hook-form"
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUsers } from "@/lib/hooks/use-misc"
import { useTranslation } from "@/lib/i18n/i18n-context"

type AttributionValues = { collectedBy?: string; collectedAt?: string }

// Form defaults for a record's collector credit — collectedAt is stored as a
// full timestamp but edited as a plain date.
export function collectedAttributionDefaults(entry?: AttributionValues): { collectedBy: string; collectedAt: string } {
  return { collectedBy: entry?.collectedBy ?? "", collectedAt: entry?.collectedAt?.slice(0, 10) ?? "" }
}

// Only what the admin actually changed. Writing both back unconditionally
// would truncate an untouched collectedAt timestamp to a bare date on every
// unrelated save, and silently re-write attribution the form never touched.
export function collectedAttributionPatch(entry: AttributionValues, values: AttributionValues): AttributionValues {
  const original = collectedAttributionDefaults(entry)
  const patch: AttributionValues = {}
  if ((values.collectedBy ?? "") !== original.collectedBy) patch.collectedBy = values.collectedBy ?? ""
  if ((values.collectedAt ?? "") !== original.collectedAt) patch.collectedAt = values.collectedAt ?? ""
  return patch
}

// The one place a collected record's collector credit can be corrected —
// All Collection shows it read-only inline once a row is Collected, so the
// row's own edit dialog (the pencil action) is where it's changed.
export function CollectedAttributionFields<T extends FieldValues>({ control }: { control: Control<T> }) {
  const { t } = useTranslation("allCollection")
  const { data: users = [] } = useUsers()
  const admins = React.useMemo(() => users.filter((u) => u.role === "admin"), [users])
  return (
    <>
      <FormField
        control={control}
        name={"collectedBy" as Path<T>}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("collectedByLabel")}</FormLabel>
            <Select value={field.value ?? ""} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("unknownAdmin")} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {admins.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={"collectedAt" as Path<T>}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("dateCollectedLabel")}</FormLabel>
            <FormControl>
              <Input type="date" {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}
