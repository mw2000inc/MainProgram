"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { HardHat, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { InstallFormDialog } from "@/components/install/install-form-dialog"
import { getInstallFullColumns, INSTALL_EXPORT_COLUMNS } from "@/components/install/install-columns"
import { useDeleteInstallPlans, useInstallPlans, useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatCurrency, formatDate, todayIso } from "@/lib/utils"
import type { InstallPlan } from "@/lib/types"

function InstallPageContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t } = useTranslation("install")
  const { t: tNav } = useTranslation("nav")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { data: plans = [], isPending } = useInstallPlans()
  const deletePlans = useDeleteInstallPlans()
  const updatePlan = useUpdateInstallPlan()

  // Deep link from e.g. the Daily Report's Installation Plan panel
  // (?id=<planId>) — opens that record's detail panel directly.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<InstallPlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<InstallPlan | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<InstallPlan[]>(plans)

  const selection = useSplitViewSelection(filteredRows, initialId)
  useDeepLinkNotFoundToast(initialId, isPending, plans.some((p) => p.id === initialId))

  const columns = React.useMemo(
    () =>
      getInstallFullColumns({
        canDelete: isAdmin,
        onDelete: (plan) => setDeleting(plan),
        onStatusChange: isAdmin ? (plan, status) => updatePlan.mutate({ id: plan.id, input: { status } }) : undefined,
      }),
    [isAdmin, updatePlan]
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const selected = selection.selected

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <HardHat className="h-6 w-6 text-primary" /> {tNav("install")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={INSTALL_EXPORT_COLUMNS} rows={plans} fileName="install-plan" />
          <Button
            className="gap-1.5"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> {tCommon("add")}
          </Button>
        </div>
      </div>

      <SplitViewLayout
        isOpen={selection.isOpen}
        expanded={selection.expanded}
        list={
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={columns}
                data={plans}
                searchPlaceholder={t("searchPlaceholder")}
                emptyMessage={t("noPlansFound")}
                onFilteredRowsChange={setFilteredRows}
                onRowClick={(row) => selection.open(row)}
              />
            </CardContent>
          </Card>
        }
        detail={
          selected && (
            <DetailPanel
              title={selected.name}
              icon={HardHat}
              subtitle={selected.orderNo}
              onEdit={
                isAdmin
                  ? () => {
                      setEditing(selected)
                      setFormOpen(true)
                    }
                  : undefined
              }
              onDelete={isAdmin ? () => setDeleting(selected) : undefined}
              onPrev={selection.prev}
              onNext={selection.next}
              hasPrev={selection.hasPrev}
              hasNext={selection.hasNext}
              expanded={selection.expanded}
              onToggleExpand={() => selection.setExpanded((v) => !v)}
              onClose={selection.close}
            >
              <DetailField label={tFields("inputDate")} value={formatDate(selected.inputDate)} />
              <DetailField label={tFields("orderNo")} value={selected.orderNo} />
              <DetailField label={tFields("name")} value={selected.name} />
              <DetailField label={tFields("address")} value={selected.address} className="sm:col-span-2" />
              <DetailField label={tFields("contactNumber")} value={selected.contactNumber} />
              <DetailField label={tFields("inOrOut")} value={selected.inOut} />
              <DetailField label={tFields("model")} value={selected.model} />
              <DetailField label={tFields("modelDp")} value={selected.modelDp} />
              <DetailField label={tFields("unitPrice")} value={formatCurrency(selected.unitPrice)} />
              <DetailField label={tFields("cpPrice")} value={formatCurrency(selected.cpPrice)} />
              <DetailField label={tFields("deliveryInstallationFee")} value={formatCurrency(selected.deliveryInstallationFee)} />
              <DetailField
                label={tFields("preInstalledDate")}
                value={selected.preInstalledDate ? formatDate(selected.preInstalledDate) : undefined}
              />
              <DetailField
                label={tFields("installedDate")}
                value={selected.installedDate ? formatDate(selected.installedDate) : undefined}
              />
              <DetailField label={tFields("status")} value={selected.status} />
              <DetailField label={tFields("note")} value={selected.note} className="sm:col-span-2" />
            </DetailPanel>
          )
        }
      />

      <InstallFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        defaultDate={todayIso()}
        plan={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        loading={deletePlans.isPending}
        onConfirm={async () => {
          if (!deleting) return
          const wasSelected = selected?.id === deleting.id
          await deletePlans.mutateAsync([deleting.id])
          setDeleting(undefined)
          if (wasSelected) selection.close()
        }}
      />
    </div>
  )
}

function InstallPageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function InstallPage() {
  return (
    <React.Suspense fallback={<InstallPageFallback />}>
      <InstallPageContent />
    </React.Suspense>
  )
}
