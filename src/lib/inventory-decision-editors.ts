// The admins who may change an Inventory List item that's already decided —
// approve a Rejected one, reject an Approved one — whoever decided it: Jan
// and cashout (the owner's request). Other admins still approve / reject
// only what's pending. Stock follows the change in the database
// (20261127000000).
export const INVENTORY_DECISION_EDITOR_IDS = [
  "de94b8d1-439e-4786-ba30-6eafbd99bd8c", // cashout
  "76f79716-33ec-405c-9cec-b4b89bce39a9", // Jan
] as const

export function canChangeInventoryDecision(userId: string | undefined): boolean {
  return !!userId && (INVENTORY_DECISION_EDITOR_IDS as readonly string[]).includes(userId)
}
