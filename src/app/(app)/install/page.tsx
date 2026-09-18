"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { HardHat, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { BreadcrumbTrail } from "@/components/shared/breadcrumb-trail"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { InstallFormDialog } from "@/components/install/install-form-dialog"
import {
  getInstallDateColumns,
  getInstallOrderGroupColumns,
  INSTALL_EXPORT_COLUMNS,
  type InstallOrderGroup,
} from "@/components/install/install-columns"
import { useDeleteInstallPlans, useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { planStatusLabel } from "@/components/shared/status-badge"
import { findCustomerByOrderNumber, findExistingMemberMatch } from "@/lib/customer-lookup"
import { formatCurrency, formatDate, todayIso } from "@/lib/utils"
import type { InstallPlan } from "@/lib/types"

function InstallPageContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t } = useTranslation("install")
  const { t: tNav } = useTranslation("nav")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const { data: plans = [], isPending } = useInstallPlans()
  const deletePlans = useDeleteInstallPlans()
  // Resolving an install record to a real member — install_plans has no
  // customer_id of its own, so this reuses the same two lookups the
  // Add/Edit form's own autofill already relies on (see customer-lookup.ts):
  // the order_no -> sale_list_entries -> customers bridge first, then a
  // name/phone match against an existing customer.
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()

  // Deep link from e.g. the Daily Report's Installation Plan panel
  // (?id=<planId>) — drills all the way in to that specific record's own
  // detail panel, not just its member's date list.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined
  const initialPlan = plans.find((p) => p.id === initialId)

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<InstallPlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<InstallPlan | undefined>(undefined)
  const [filteredGroups, setFilteredGroups] = React.useState<InstallOrderGroup[]>([])

  // One row per distinct MEMBER (Member Account#) rather than per order_no —
  // a member with several different order numbers (repeat installs logged
  // under separate orders) collapses into one row here, with `records`
  // spanning every one of those orders.
  //
  // Resolution tries the strongest signal first (an actual order ->
  // sale_list_entries -> customers link), then falls back to a name/phone
  // match against an existing customer — phone included (unlike Repair's
  // own name-only fallback) because install_plans' own `name` field is
  // typed per install *site*, not per account (e.g. "Maxicare_DD Meridian"
  // and "Maxicare_Centris" are the same member's two different install
  // locations, sharing a phone number but not a name) — checked live
  // against production data before deciding, see getInstallOrderGroupColumns'
  // own InstallOrderGroup comment for the full reasoning.
  //
  // A record that resolves neither way (no matching order, no matching
  // name/phone, or a matched customer with no member account number
  // assigned) falls back to being grouped by its own (trimmed,
  // case-insensitive) name text instead — so e.g. two same-named walk-in
  // installs still collapse together even without a real member match,
  // rather than silently dropping the record, merging it into an unrelated
  // member, or leaving it stranded as its own row per order (there's no
  // order_no column shown here anymore to tell those apart by anyway). See
  // getInstallOrderGroupColumns' own MemberAccountCell for how the "no real
  // match" case is displayed.
  //
  // Most recent date first within each group, which is also where
  // latestDate (MAX(input_date) across the group — its own sortable
  // column) comes from: recomputed fresh from `plans` every time, never a
  // stored value, so a newly added install immediately becomes the latest
  // without anything else needing to change.
  const orderGroups = React.useMemo<InstallOrderGroup[]>(() => {
    const byMember = new Map<string, InstallPlan[]>()
    const byName = new Map<string, InstallPlan[]>()
    for (const p of plans) {
      const viaOrder = findCustomerByOrderNumber(customers, saleListEntries, p.orderNo)
      const viaName = viaOrder
        ? undefined
        : findExistingMemberMatch(customers, { contactNumber: p.contactNumber, fullName: p.name, companyName: p.name })
            ?.customer
      const memberAccountNumber = (viaOrder ?? viaName)?.memberAccountNumber?.trim()
      const map = memberAccountNumber ? byMember : byName
      const key = memberAccountNumber || p.name.trim().toLowerCase()
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }

    function toGroup(id: string, memberAccountNumber: string | undefined, records: InstallPlan[]): InstallOrderGroup {
      const sorted = [...records].sort((a, b) => b.inputDate.localeCompare(a.inputDate))
      // Every member in this group resolved to the exact same customer (the
      // map key IS that customer's memberAccountNumber, which is unique —
      // see customers_member_account_number_unique_idx), so one lookup here
      // covers the whole group's own "SK001-####" number alongside each
      // record's own "001-####" orderNo.
      const linkedCustomer = memberAccountNumber
        ? customers.find((c) => c.memberAccountNumber.trim() === memberAccountNumber)
        : undefined
      const orderNumbers = Array.from(
        new Set([
          ...records.map((r) => r.orderNo.trim()).filter(Boolean),
          ...(linkedCustomer?.orderNumber.trim() ? [linkedCustomer.orderNumber.trim()] : []),
        ])
      ).join(" ")
      return {
        id,
        memberAccountNumber,
        name: sorted[0].name,
        latestDate: sorted[0].inputDate,
        records: sorted,
        orderNumbers,
        latest: sorted[0],
      }
    }

    const linkedGroups = Array.from(byMember, ([memberAccountNumber, records]) =>
      toGroup(`member:${memberAccountNumber}`, memberAccountNumber, records)
    )
    const unlinkedGroups = Array.from(byName, ([nameKey, records]) => toGroup(`name:${nameKey}`, undefined, records))
    return [...linkedGroups, ...unlinkedGroups]
  }, [plans, customers, saleListEntries])

  // Whichever group's own `records` actually contains the deep-linked
  // plan — not recomputed via a separate lookup, so it can never disagree
  // with however orderGroups itself just resolved that same record.
  const initialGroupId = React.useMemo(
    () => (initialPlan ? orderGroups.find((g) => g.records.some((r) => r.id === initialPlan.id))?.id : undefined),
    [orderGroups, initialPlan]
  )

  const orderSelection = useSplitViewSelection(filteredGroups, initialGroupId)
  // The specific install visit (date) shown within the drilled-into member —
  // scoped to that member's own records, not the full plans list, so Prev/
  // Next steps through this member's dates rather than every unrelated
  // install in the whole table.
  const selection = useSplitViewSelection(orderSelection.selected?.records ?? [], initialId)
  useDeepLinkNotFoundToast(initialId, isPending, plans.some((p) => p.id === initialId))

  const orderGroupColumns = React.useMemo(() => getInstallOrderGroupColumns(), [])
  const dateColumns = React.useMemo(() => getInstallDateColumns(), [])

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
    // h-full so this page's own share of <main> (already the app's one real
    // scroll region — see layout.tsx) is a real, definite height rather
    // than "however tall my content happens to be" — everything below that
    // isn't the table area is shrink-0, so the table's flex-1 share is
    // exactly "whatever's left," and its own internal scroll (see
    // data-table.tsx's h-full) is the only thing that ever needs to move.
    <div className="flex h-full flex-col gap-6 overflow-hidden">
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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

      {!orderSelection.selected ? (
        // Level 1: one row per member (Name / Member Account#) — no side
        // panel at this level, clicking a row drills all the way into that
        // member's own date list + detail view below instead.
        <Card className="flex-1 min-h-0">
          <CardContent className="flex flex-1 min-h-0 flex-col pt-6">
            <div className="flex-1 min-h-0 overflow-hidden">
              <DataTable
                columns={orderGroupColumns}
                data={orderGroups}
                searchPlaceholder={t("searchPlaceholder")}
                emptyMessage={t("noPlansFound")}
                onFilteredRowsChange={setFilteredGroups}
                onRowClick={orderSelection.open}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
          <BreadcrumbTrail
            items={[
              { label: tNav("install"), onClick: orderSelection.close },
              {
                label: orderSelection.selected.memberAccountNumber
                  ? `${orderSelection.selected.memberAccountNumber} — ${orderSelection.selected.name}`
                  : orderSelection.selected.name,
              },
            ]}
          />
          {/* Level 2 + 3 combined: a narrow list of this member's own install
              dates alongside the currently-selected one's full detail —
              same listWidth="narrow" list+detail pair Repair Plan already
              uses for Member -> Date. */}
          <SplitViewLayout
            isOpen
            expanded={selection.expanded}
            listWidth="narrow"
            fillHeight
            className="flex-1 min-h-0"
            list={
              <Card className="flex-1 min-h-0">
                <CardContent className="flex flex-1 min-h-0 flex-col pt-6">
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <DataTable
                      columns={dateColumns}
                      data={orderSelection.selected.records}
                      searchPlaceholder={t("searchPlaceholderDates")}
                      emptyMessage={t("noPlansForDate")}
                      onRowClick={(row) => selection.open(row)}
                    />
                  </div>
                </CardContent>
              </Card>
            }
            detail={
              selected ? (
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
                  // Closing goes all the way back to the member list rather
                  // than just deselecting the date — there's no dedicated
                  // "clear the date but stay on this member" gesture, since
                  // the empty-state placeholder below already covers that.
                  onClose={orderSelection.close}
                  fillHeight
                >
                  <DetailField label={tFields("inputDate")} value={formatDate(selected.inputDate)} />
                  {/* Same plain "YYYY-MM" slice the Add/Edit form computes
                      live from this same field (see install-form-dialog.tsx)
                      — not a stored column, just surfaced here too. */}
                  <DetailField label={tFields("yearMonthPlan")} value={selected.inputDate.slice(0, 7)} />
                  <DetailField label={tFields("orderNo")} value={selected.orderNo} />
                  <DetailField label={tFields("name")} value={selected.name} />
                  <DetailField label={tFields("address")} value={selected.address} className="sm:col-span-2" />
                  <DetailField label={tFields("contactNumber")} value={selected.contactNumber} />
                  {/* install_plans has no member_account_number/customer_id
                      column of its own — this is the member this record's
                      own group already resolved (see orderGroups' own
                      comment on that lookup), not a separate query. */}
                  <DetailField label={tFields("memberAccount")} value={orderSelection.selected.memberAccountNumber} />
                  <DetailField label={tFields("inOrOut")} value={selected.inOut} />
                  <DetailField label={tFields("model")} value={selected.model} />
                  <DetailField label={tFields("modelDp")} value={selected.modelDp} />
                  <DetailField label={tFields("unitPrice")} value={formatCurrency(selected.unitPrice)} />
                  <DetailField label={tFields("cpPrice")} value={formatCurrency(selected.cpPrice)} />
                  <DetailField label={tFields("deliveryInstallationFee")} value={formatCurrency(selected.deliveryInstallationFee)} />
                  <DetailField label={tFields("paymentMode")} value={selected.paymentMode} />
                  <DetailField label={tFields("receiptNo")} value={selected.receiptNo} />
                  <DetailField
                    label={tFields("preInstalledDate")}
                    value={selected.preInstalledDate ? formatDate(selected.preInstalledDate) : undefined}
                  />
                  <DetailField
                    label={tFields("installedDate")}
                    value={selected.installedDate ? formatDate(selected.installedDate) : undefined}
                  />
                  <DetailField label={tFields("salesPerson")} value={selected.salesPerson} />
                  <DetailField label={tFields("via")} value={selected.via} />
                  <DetailField label={tFields("serviceman")} value={selected.serviceman} />
                  <DetailField label={tFields("status")} value={planStatusLabel(selected.status, tStatus)} />
                  <DetailField label={tFields("note")} value={selected.note} className="sm:col-span-2" />
                </DetailPanel>
              ) : (
                // Nothing picked yet — opening a member no longer
                // auto-selects a date (even a single-date member still
                // requires an explicit click), so this is the normal
                // starting state, not an error/empty-data condition.
                <Card className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                  <HardHat className="h-8 w-8 text-muted-foreground/40" />
                  <p>{t("selectDatePrompt")}</p>
                </Card>
              )
            }
          />
        </div>
      )}

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
          if (wasSelected) {
            const remaining = (orderSelection.selected?.records ?? []).filter((p) => p.id !== deleting.id)
            if (remaining.length > 0) selection.open(remaining[0])
            else orderSelection.close()
          }
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
