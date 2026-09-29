"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Mail, Pencil, Check, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateCustomerNotificationEmail } from "@/lib/api/push-subscriptions"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"

// The Member Information tab's own persistent Email Address row. Unlike
// PushOptInBanner's email field (same panel, same customers.email column,
// same RPC) this one never disappears — the banner permanently hides itself
// once a customer dismisses it or once the browser's push permission is
// already decided one way or the other, so it can't be relied on as the
// only place to fix a wrong or missing email later. Both write through
// update_customer_notification_email and both read from the same
// portalProfile query, so saving here also updates the banner's own field
// (and vice versa) without any extra plumbing.
export function EditableMemberEmail({
  customerId,
  email,
  label,
}: {
  customerId: string
  email: string
  label: string
}) {
  const { t } = useTranslation("portal")
  const { t: tCommon } = useTranslation("common")
  const queryClient = useQueryClient()
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(email)
  const [busy, setBusy] = React.useState(false)

  function handleCancel() {
    setValue(email)
    setEditing(false)
  }

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === email) {
      handleCancel()
      return
    }
    setBusy(true)
    try {
      await updateCustomerNotificationEmail(customerId, trimmed)
      await queryClient.invalidateQueries({ queryKey: ["portalProfile", customerId] })
      toast.success(t("preferencesSaved"))
      setEditing(false)
    } catch {
      toast.error(t("preferencesSaveFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
        <Mail className="h-3.5 w-3.5" /> {label}
      </p>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("notifyEmailPlaceholder")}
            disabled={busy}
            className="h-8"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave()
              if (e.key === "Escape") handleCancel()
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={handleSave}
            disabled={busy}
            aria-label={tCommon("save")}
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={handleCancel}
            disabled={busy}
            aria-label={tCommon("cancel")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setValue(email)
            setEditing(true)
          }}
          className="font-medium flex items-center gap-1.5 group text-left"
        >
          {email || <span className="font-normal italic text-muted-foreground">{t("notifyEmailPlaceholder")}</span>}
          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
