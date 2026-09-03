"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useUpdateCpSystem } from "@/lib/hooks/use-cp-systems"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { CpSystem, CpSystemComponent } from "@/lib/types"

function createSchema(
  t: (key: string, params?: Record<string, string>) => string,
  tc: (key: string) => string,
  tf: (key: string) => string
) {
  return z.object({
    name: z.string().min(1, t("requiredField", { field: tf("filter") })),
    intervalMonths: z.number().int().min(1, tc("mustBeAtLeastOne")),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(component?: CpSystemComponent): FormValues {
  return {
    name: component?.name ?? "",
    intervalMonths: component?.intervalMonths ?? 6,
  }
}

// Adds or edits a single row of a CP System's CP_SystemDetails sub-table —
// the components jsonb array on cp_systems has no per-row ids of its own, so
// this reads/writes the whole array on the parent system rather than
// talking to a separate table. `index` selects which entry `editing`
// refers to; omit both to append a new one.
export function CpSystemComponentFormDialog({
  open,
  onOpenChange,
  system,
  editing,
  index,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  system: CpSystem
  editing?: CpSystemComponent
  index?: number
}) {
  const isEdit = !!editing && index !== undefined
  const updateSystem = useUpdateCpSystem()
  const { t } = useTranslation("cpSystem")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(tCommon, t, tFields), [tCommon, t, tFields])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(editing),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(editing))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  async function onSubmit(values: FormValues) {
    const components = [...system.components]
    if (isEdit) {
      components[index] = values
    } else {
      components.push(values)
    }
    await updateSystem.mutateAsync({ id: system.id, input: { components } })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editComponentTitle") : t("addComponentTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editComponentDescription") : t("addComponentDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("filter")}</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. MW) Sediment" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-2">
              <Label>{t("filterTermMonths")}</Label>
              <Input
                type="number"
                min={1}
                onFocus={(e) => e.target.select()}
                {...form.register("intervalMonths", { valueAsNumber: true })}
              />
              {form.formState.errors.intervalMonths && (
                <p className="text-destructive text-sm">{form.formState.errors.intervalMonths.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={updateSystem.isPending}>
                {updateSystem.isPending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : tCommon("add")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
