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
import type { CpSystem } from "@/lib/types"

const componentSchema = z.object({
  name: z.string().min(1, "Required"),
  intervalMonths: z.number().int().min(1, "Must be at least 1"),
})

const schema = z.object({
  systemCode: z.string().min(1, "System code is required"),
  components: z.array(componentSchema).min(1, "Add at least one filter component"),
})

type FormValues = z.infer<typeof schema>

function defaultValues(system?: CpSystem): FormValues {
  return {
    systemCode: system?.systemCode ?? "",
    components: system?.components?.length ? system.components : [{ name: "", intervalMonths: 6 }],
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
          <DialogTitle>{isEdit ? "Edit CP System" : "Add CP System"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this system's code and filter components."
              : "Define a system code and the filter components it's built from."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-2">
            <Label>System Code</Label>
            <Input placeholder="e.g. UF71" className="font-mono" {...form.register("systemCode")} />
            {errors.systemCode && <p className="text-destructive text-sm">{errors.systemCode.message}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Filter Components</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => append({ name: "", intervalMonths: 6 })}
              >
                <Plus className="h-3.5 w-3.5" /> Add Component
              </Button>
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
                  <div className="w-28 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        onFocus={(e) => e.target.select()}
                        {...form.register(`components.${index}.intervalMonths`, { valueAsNumber: true })}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">mo</span>
                    </div>
                    {errors.components?.[index]?.intervalMonths && (
                      <p className="text-destructive text-xs mt-1">{errors.components[index]?.intervalMonths?.message}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-danger hover:text-danger shrink-0"
                    title="Remove component"
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
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : isEdit ? "Save Changes" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
