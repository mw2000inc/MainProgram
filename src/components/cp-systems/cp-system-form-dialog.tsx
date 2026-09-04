"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFieldArray } from "react-hook-form"
import { Plus, Trash2 } from "lucide-react"
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
import { useCreateCpSystem, useUpdateCpSystem } from "@/lib/hooks/use-cp-systems"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { CpSystem } from "@/lib/types"

function createSchema(
  t: (key: string, params?: Record<string, string>) => string,
  tc: (key: string) => string,
  tf: (key: string) => string
) {
  const componentSchema = z.object({
    name: z.string().min(1, tf("required")),
    intervalMonths: z.number().int().min(1, tc("mustBeAtLeastOne")),
    quantity: z.number().int().min(1, tc("mustBeAtLeastOne")),
  })

  return z.object({
    systemCode: z.string().min(1, t("requiredField", { field: tf("systemCode") })),
    components: z.array(componentSchema).min(1, tc("addAtLeastOneComponent")),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(system?: CpSystem): FormValues {
  return {
    systemCode: system?.systemCode ?? "",
    // Every existing component predates the quantity field — normalize it to
    // the implied default of 1 here so an existing system's row never opens
    // this dialog with a blank quantity input (same fallback used throughout
    // the app wherever a component's quantity is read).
    components: system?.components?.length
      ? system.components.map((c) => ({ ...c, quantity: c.quantity ?? 1 }))
      : [{ name: "", intervalMonths: 6, quantity: 1 }],
  }
}

export function CpSystemFormDialog({
  open,
  onOpenChange,
  system,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Editing an existing system instead of creating a new one.
  system?: CpSystem
}) {
  const isEdit = !!system
  const createSystem = useCreateCpSystem()
  const updateSystem = useUpdateCpSystem()
  const { t } = useTranslation("cpSystem")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(tCommon, t, tFields), [tCommon, t, tFields])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(system),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(system))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, system])

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "components" })

  async function onSubmit(values: FormValues) {
    if (isEdit) {
      await updateSystem.mutateAsync({ id: system.id, input: values })
    } else {
      await createSystem.mutateAsync(values)
    }
    onOpenChange(false)
  }

  const pending = createSystem.isPending || updateSystem.isPending
  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDescription") : t("addDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-2">
            <Label>{tFields("systemCode")}</Label>
            <Input placeholder="e.g. UF71" className="font-mono" {...form.register("systemCode")} />
            {errors.systemCode && <p className="text-destructive text-sm">{errors.systemCode.message}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("filterComponents")}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => append({ name: "", intervalMonths: 6, quantity: 1 })}
              >
                <Plus className="h-3.5 w-3.5" /> {t("addComponent")}
              </Button>
            </div>
            {/* Column headers, shown once above the list rather than
                repeated per row — the Name column is self-explanatory from
                its placeholder, same as before this field existed. */}
            <div className="flex items-center gap-2 px-0.5">
              <div className="flex-1" />
              <Label className="w-20 shrink-0 text-xs text-muted-foreground font-normal">{t("filterTermMonths")}</Label>
              <Label className="w-20 shrink-0 text-xs text-muted-foreground font-normal">{tFields("quantity")}</Label>
              <div className="w-9 shrink-0" />
            </div>
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <div className="flex-1">
                    <Input placeholder="e.g. MW) Sediment" {...form.register(`components.${index}.name`)} />
                    {errors.components?.[index]?.name && (
                      <p className="text-destructive text-xs mt-1">{errors.components[index]?.name?.message}</p>
                    )}
                  </div>
                  <div className="w-20 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      onFocus={(e) => e.target.select()}
                      {...form.register(`components.${index}.intervalMonths`, { valueAsNumber: true })}
                    />
                    {errors.components?.[index]?.intervalMonths && (
                      <p className="text-destructive text-xs mt-1">{errors.components[index]?.intervalMonths?.message}</p>
                    )}
                  </div>
                  <div className="w-20 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      onFocus={(e) => e.target.select()}
                      {...form.register(`components.${index}.quantity`, { valueAsNumber: true })}
                    />
                    {errors.components?.[index]?.quantity && (
                      <p className="text-destructive text-xs mt-1">{errors.components[index]?.quantity?.message}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-danger hover:text-danger shrink-0"
                    title={t("removeComponent")}
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : tCommon("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
