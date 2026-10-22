"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Plus, Printer } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import {
  applySlipEdits,
  blankSlipJob,
  ReleaseSlipSheets,
  type SlipEdits,
  type SlipJobEdit,
  type SlipSignatures,
  type SlipSkuOption,
} from "@/components/release-slip/release-slip-sheets"
import type { ReleaseSlipJob } from "@/lib/api/release-slip"
import type { SlipChannel } from "@/lib/release-slip-channels"

// The Shopee / Lazada slip (admin only; picked like a technician on the
// Release Slip page): the day's online orders, one row each — Order No.,
// buyer (Accnt. Name) and the items sent out / returned. Typed straight on the
// slip like a technician's; each edited or added order is saved a moment
// later as pending Inventory items (reason Shopee / Lazada) for an admin to
// approve. See /api/release-slip/channel.

type ChannelOrder = { orderNo: string; accountName: string; movements: ReleaseSlipJob["movements"] }
type SaveOrder = { orderNo: string; previousOrderNo?: string; accountName: string; items: { sku: string; qtyOut: number; qtyIn: number }[] }

const JOB_PREFIX = "ch:"

export function ChannelReleaseSlip({
  channel,
  date,
  signatures,
  onSignaturesChange,
  skuOptions,
  onPrint,
}: {
  channel: SlipChannel
  date: string
  signatures: SlipSignatures
  onSignaturesChange: (next: SlipSignatures) => void
  skuOptions: SlipSkuOption[]
  // "Download PDF": the page's print-as-file helper, with this slip's name.
  onPrint: (title: string) => void
}) {
  const qc = useQueryClient()
  const queryKey = ["channelSlip", channel, date]
  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<ChannelOrder[]> => {
      const res = await fetch(`/api/release-slip/channel?date=${date}&channel=${channel}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "Couldn't load the slip")
      return body.orders as ChannelOrder[]
    },
  })

  // Edits and added rows, for this channel and date only.
  const stateKey = `${channel}|${date}`
  const [state, setState] = React.useState<{ key: string; edits: SlipEdits; added: string[] }>({ key: stateKey, edits: {}, added: [] })
  if (state.key !== stateKey) setState({ key: stateKey, edits: {}, added: [] })
  const onEdit = (jobId: string, patch: SlipJobEdit) =>
    setState((s) => {
      const prev = s.edits[jobId] ?? {}
      const lines = { ...(prev.lines ?? {}) }
      for (const [i, le] of Object.entries(patch.lines ?? {})) lines[Number(i)] = { ...(lines[Number(i)] ?? {}), ...le }
      return { ...s, edits: { ...s.edits, [jobId]: { ...prev, ...patch, lines } } }
    })

  const base = React.useMemo(
    (): ReleaseSlipJob[] =>
      (data ?? []).map((o) => ({
        jobId: JOB_PREFIX + o.orderNo,
        orderNo: o.orderNo,
        accountName: o.accountName,
        jobType: "manual",
        status: "completed",
        technician: "",
        technician2: "",
        movements: o.movements,
      })),
    [data]
  )
  const jobs = applySlipEdits([...base, ...state.added.map(blankSlipJob)], state.edits)

  const post = async (orders: SaveOrder[]) => {
    const res = await fetch("/api/release-slip/channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, channel, orders }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || "Save failed")
    await Promise.all([qc.invalidateQueries({ queryKey }), qc.invalidateQueries({ queryKey: ["stockMovements"] })])
  }

  // Auto-save: every order edited or added here, 1.5 s after the last edit —
  // once it has an Order No. and at least one item with a quantity (an order
  // is stored only as its items, so saving it empty would drop the row and
  // what was typed). Saved edits are dropped so the slip shows what the
  // database now holds; anything typed while saving saves next round. An
  // order is removed with its ×, not by emptying it.
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved">("idle")
  const running = React.useRef(false)
  const itemsOf = (j: ReleaseSlipJob) =>
    j.movements.flatMap((m) => {
      const out = { sku: (m.sku || m.label).trim(), qtyOut: m.qtyOut || 0, qtyIn: m.inSku ? 0 : m.qtyIn || 0 }
      const back = m.inSku && m.qtyIn ? [{ sku: m.inSku.trim(), qtyOut: 0, qtyIn: m.qtyIn }] : []
      return [...(out.sku && (out.qtyOut || out.qtyIn) ? [out] : []), ...back]
    })
  React.useEffect(() => {
    const touched = jobs.filter((j) => (j.added || state.edits[j.jobId]) && j.orderNo.trim() && itemsOf(j).length > 0)
    if (!touched.length || !data) return
    const snapshot = state
    const timer = window.setTimeout(async () => {
      if (running.current) return
      running.current = true
      setStatus("saving")
      try {
        await post(
          touched.map((j) => ({
            orderNo: j.orderNo.trim(),
            previousOrderNo: j.added ? undefined : j.jobId.slice(JOB_PREFIX.length),
            accountName: j.accountName,
            items: itemsOf(j),
          }))
        )
        const sent = new Set(touched.map((j) => j.jobId))
        setState((s) => {
          if (s.key !== snapshot.key) return s
          const edits = { ...s.edits }
          for (const id of sent) if (edits[id] === snapshot.edits[id]) delete edits[id]
          return { ...s, edits, added: s.added.filter((id) => !(sent.has(id) && s.edits[id] === snapshot.edits[id])) }
        })
        setStatus("saved")
      } catch (e) {
        setStatus("idle")
        toast.error(e instanceof Error ? e.message : "Save failed")
      } finally {
        running.current = false
      }
    }, 1500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, data])

  // An order's ×: asked first, then its pending items are removed.
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState(false)
  async function confirmRemove() {
    if (!pendingRemove) return
    setRemoving(true)
    try {
      await post([{ orderNo: pendingRemove, previousOrderNo: pendingRemove, accountName: "", items: [] }])
      setState((s) => {
        const edits = { ...s.edits }
        delete edits[JOB_PREFIX + pendingRemove]
        return { ...s, edits }
      })
      toast.success(`${pendingRemove} removed from the ${channel} slip`)
      setPendingRemove(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove the order")
    } finally {
      setRemoving(false)
    }
  }

  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // The Store line, typed on the slip (e.g. "Lazada — MW2000 Official"):
  // remembered per store in this browser; blank until typed = the store name.
  const whoKey = `release-slip-store:${channel}`
  const [who, setWho] = React.useState<{ key: string; value: string | undefined }>({ key: "", value: undefined })
  if (mounted && who.key !== whoKey) {
    let saved: string | undefined
    try {
      saved = window.localStorage.getItem(whoKey) ?? undefined
    } catch {
      saved = undefined
    }
    setWho({ key: whoKey, value: saved })
  }
  const slipSignatures: SlipSignatures = { ...signatures, who: who.value }
  const changeSignatures = (next: SlipSignatures) => {
    const { who: typed, ...rest } = next
    if (typed !== who.value) {
      setWho({ key: whoKey, value: typed })
      try {
        window.localStorage.setItem(whoKey, typed ?? "")
      } catch {
        // not remembered (private window / storage blocked)
      }
    }
    onSignaturesChange(rest)
  }

  const ready = !!data && !isPending
  const sheets = (editable: boolean) => (
    <ReleaseSlipSheets
      date={date}
      technicianName={channel}
      whoLabel="Store:"
      whoEditable
      typeBoxes={false}
      combine={false}
      jobs={jobs}
      signatures={slipSignatures}
      onSignaturesChange={editable ? changeSignatures : undefined}
      onEdit={editable ? onEdit : undefined}
      onRemoveJob={
        editable
          ? (jobId) => setState((s) => ({ ...s, added: s.added.filter((id) => id !== jobId), edits: Object.fromEntries(Object.entries(s.edits).filter(([id]) => id !== jobId)) }))
          : undefined
      }
      onRemoveOrder={editable ? (_ids, orderNo) => setPendingRemove(orderNo) : undefined}
      skuOptions={editable ? skuOptions : undefined}
    />
  )
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2" data-testid="channel-slip-toolbar">
        <Button size="sm" className="gap-1.5" onClick={() => onPrint(`release-slip-${date}-${channel.toLowerCase()}`)} disabled={!ready}>
          <Download className="h-3.5 w-3.5" /> Download PDF
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.print()} disabled={!ready}>
          <Printer className="h-3.5 w-3.5" /> Print Release Slip
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setState((s) => ({ ...s, added: [...s.added, `added-${Date.now()}`] }))}
          disabled={!ready}
          data-testid="channel-add-order"
        >
          <Plus className="h-3.5 w-3.5" /> Add Order No.
        </Button>
        <span className="text-xs text-muted-foreground" data-testid="channel-autosave-status">
          {status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Saved to the Inventory List (pending approval)"
              : `Type each ${channel} order on the slip — once it has an item and quantity, it's added to the Inventory List automatically.`}
        </span>
      </div>
      {error ? (
        <p className="text-sm text-danger">{error instanceof Error ? error.message : "Couldn't load the slip"}</p>
      ) : !ready ? (
        <Skeleton className="h-150 w-[210mm] max-w-full" />
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="channel-slip-count">
            {base.length} {channel} order(s) on this slip
          </p>
          <div className="overflow-x-auto rounded-md border bg-muted/40 p-3">
            <div className="flex w-max flex-col gap-4">{sheets(true)}</div>
          </div>
          {mounted && createPortal(<div className="release-slip-print">{sheets(false)}</div>, document.body)}
        </>
      )}
      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(o) => !o && !removing && setPendingRemove(null)}
        title={`Remove ${pendingRemove ?? ""} from the ${channel} slip?`}
        description="Its pending items are removed from the Inventory List. Items already approved stay."
        confirmLabel="Remove"
        loading={removing}
        onConfirm={confirmRemove}
      />
    </>
  )
}
