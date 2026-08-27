"use client"

import * as React from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useDailyReportSections, useReorderDailyReportSections, useUpdateDailyReportSection } from "@/lib/hooks/use-daily-report-sections"
import { SECTION_FIELDS, SECTION_ICONS, resolveSectionConfigs } from "@/lib/daily-report-sections-config"
import { cn } from "@/lib/utils"
import type { DailyReportSectionConfig, DailyReportSectionKey } from "@/lib/types"

function SortableRow({
  section,
  onEdit,
  onToggleEnabled,
}: {
  section: DailyReportSectionConfig
  onEdit: () => void
  onToggleEnabled: (enabled: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.sectionKey,
  })
  const Icon = SECTION_ICONS[section.sectionKey]
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-md border p-2.5",
        isDragging && "relative z-10 opacity-60",
        !section.enabled && "opacity-60"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab text-muted-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 text-primary shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm font-medium">{section.label}</span>
      <div className="flex items-center gap-2">
        <Switch checked={section.enabled} onCheckedChange={onToggleEnabled} aria-label={`${section.enabled ? "Disable" : "Enable"} ${section.label}`} />
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function EditSectionDialog({
  section,
  onOpenChange,
}: {
  section: DailyReportSectionConfig | undefined
  onOpenChange: (open: boolean) => void
}) {
  const updateSection = useUpdateDailyReportSection()
  const fields = section ? SECTION_FIELDS[section.sectionKey] : undefined

  // Lazy initializers, not an effect — the parent remounts this component
  // (via a `key` keyed on section.sectionKey) whenever a different section
  // is opened, so these only ever need to compute once per section, not
  // resync on every render.
  const [label, setLabel] = React.useState(section?.label ?? "")
  const [enabled, setEnabled] = React.useState(section?.enabled ?? true)
  // Empty saved visibleFields means "show all" — expand that into every
  // field checked, rather than showing an all-unchecked list, the first
  // time this section is edited.
  const [visibleFields, setVisibleFields] = React.useState<Set<string>>(() => {
    const availableKeys = fields?.map((f) => f.key) ?? []
    return new Set(section && section.visibleFields.length > 0 ? section.visibleFields : availableKeys)
  })

  function toggleField(key: string, checked: boolean) {
    setVisibleFields((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function handleSave() {
    if (!section) return
    const allChecked = fields ? fields.every((f) => visibleFields.has(f.key)) : true
    await updateSection.mutateAsync({
      sectionKey: section.sectionKey,
      input: {
        label: label.trim() || section.label,
        enabled,
        // All checked collapses back to "show all" ([]), same convention as
        // a section that's never been edited — avoids the visible set
        // silently going stale if a field is added to SECTION_FIELDS later.
        visibleFields: fields ? (allChecked ? [] : fields.filter((f) => visibleFields.has(f.key)).map((f) => f.key)) : [],
      },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={!!section} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Section</DialogTitle>
          <DialogDescription>Change how this section appears on the Daily Report for every user.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Section Name</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label className="cursor-pointer">Enabled</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          {fields && (
            <div className="space-y-2">
              <Label>Visible Fields</Label>
              <div className="space-y-1.5 rounded-md border p-3">
                {fields.map((field) => (
                  <label key={field.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={visibleFields.has(field.key)}
                      onCheckedChange={(checked) => toggleField(field.key, checked === true)}
                    />
                    {field.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={updateSection.isPending}>
            {updateSection.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Admin-only configuration for the Daily Report's six sections — a single
// shared daily_report_sections row per section (not per-admin), so a change
// here immediately affects every viewer's Daily Report, technicians
// included. RLS is the real enforcement (INSERT/UPDATE/DELETE require
// is_admin()); this panel is only reachable at all via the Settings page's
// own AdminGuard.
export function DailyReportSectionsPanel() {
  const { data, isPending } = useDailyReportSections()
  const updateSection = useUpdateDailyReportSection()
  const reorderSections = useReorderDailyReportSections()
  const [editing, setEditing] = React.useState<DailyReportSectionConfig | undefined>(undefined)

  const sections = React.useMemo(() => resolveSectionConfigs(data ?? []), [data])
  const [localOrder, setLocalOrder] = React.useState<DailyReportSectionKey[] | null>(null)
  const order = localOrder ?? sections.map((s) => s.sectionKey)
  const byKey = new Map(sections.map((s) => [s.sectionKey, s]))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(active.id as DailyReportSectionKey)
    const newIndex = order.indexOf(over.id as DailyReportSectionKey)
    const next = arrayMove(order, oldIndex, newIndex)
    setLocalOrder(next)
    reorderSections.mutate(next)
  }

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Report Sections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Daily Report Sections</CardTitle>
        <CardDescription>
          Drag to reorder, toggle to show/hide, or edit a section&apos;s name and visible fields. Changes apply to
          everyone&apos;s Daily Report immediately, including technicians.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {order.map((key) => {
                const section = byKey.get(key)
                if (!section) return null
                return (
                  <SortableRow
                    key={key}
                    section={section}
                    onEdit={() => setEditing(section)}
                    onToggleEnabled={(enabled) => updateSection.mutate({ sectionKey: key, input: { enabled } })}
                  />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      </CardContent>

      <EditSectionDialog
        key={editing?.sectionKey ?? "none"}
        section={editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
      />
    </Card>
  )
}
