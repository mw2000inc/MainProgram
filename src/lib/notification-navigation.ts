import { resolveEntityTarget, type ActivityLogTarget } from "@/lib/activity-log-navigation"
import type { AppNotification, NotificationType } from "@/lib/types"

// Which real table a notification's own related_entity_id actually points
// into — confirmed against exactly what each notification-creating
// trigger inserts, not guessed:
//   * new-customer (sale_invoice_and_notifications migration):
//     customers.id.
//   * low-stock / out-of-stock (sale_services_and_stock_movement_edit and
//     ct_filter_change_collection_inventory_link migrations): products.id
//     — same ?id= deep link Inventory's own list page already resolves
//     for Activity Log clicks.
//   * new-sale (sale_invoice_and_notifications migration): the legacy
//     `sales` table's own id — superseded by sale_list_entries, nothing in
//     the app reads or writes it anymore (resolveEntityTarget already
//     reports this table as having no page at all, same conclusion
//     resolveActivityLogTarget reached).
//   * expiring-contract: no trigger currently creates one (checked every
//     migration) — a contract's start/end lives on customers, so this is
//     the best available answer if one is ever actually inserted.
const NOTIFICATION_ENTITY_TYPE: Record<NotificationType, string> = {
  "new-customer": "customers",
  "expiring-contract": "customers",
  "low-stock": "products",
  "out-of-stock": "products",
  "new-sale": "sales",
}

// Reuses resolveEntityTarget — the exact same entity_type -> route table
// the Admin/Technician Activity Log's own row-click already resolves
// through — rather than a second, independently-maintained copy of these
// routes. A notification's own `type` just needs translating into the real
// table name first: notifications.type is a business-level label
// ("new-customer"), not a Postgres table name the way activity_logs.
// entity_type already is.
export function resolveNotificationTarget(notification: AppNotification): ActivityLogTarget | undefined {
  if (!notification.relatedEntityId) return undefined
  return resolveEntityTarget(NOTIFICATION_ENTITY_TYPE[notification.type], notification.relatedEntityId)
}
