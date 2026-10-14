"use client"

import * as React from "react"
import { Pencil, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useTranslation } from "@/lib/i18n/i18n-context"

export type DetailField = { label: string; value?: React.ReactNode }

// A record's details as a centered card — AppSheet's detail view: each field's
// label above its value, one under the other, and Edit at the top right. Opened
// in place (no page change), so closing it returns to the same spot.
export function RecordDetailDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  icon: Icon,
  fields,
  onEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: LucideIcon
  fields: DetailField[]
  onEdit?: () => void
}) {
  const { t } = useTranslation("common")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-md" data-testid="record-detail-dialog">
        <DialogHeader className="flex-row items-start justify-between gap-3 border-b p-4 pr-12 text-left">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
              <span className="wrap-break-word">{title}</span>
            </DialogTitle>
            {subtitle && <DialogDescription className="mt-0.5">{subtitle}</DialogDescription>}
          </div>
          {onEdit && (
            <Button size="sm" className="h-8 shrink-0 gap-1.5 rounded-full px-3" onClick={onEdit} data-testid="record-detail-edit">
              <Pencil className="h-3.5 w-3.5" /> {t("edit")}
            </Button>
          )}
        </DialogHeader>
        <dl className="flex-1 divide-y overflow-y-auto px-4">
          {fields.map((f) => (
            <div key={f.label} className="py-2.5">
              <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 text-sm wrap-break-word">{f.value === undefined || f.value === null || f.value === "" ? "—" : f.value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
