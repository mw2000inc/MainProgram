// @supabase/auth-js treats any 5xx response as a generic "retryable/network"
// error (see AuthRetryableFetchError in its own fetch.ts) and never parses
// the response body for that status range — error.message ends up being
// JSON.stringify() of the raw fetch Response object, which has no own
// enumerable properties, so it's literally the string "{}" — not whatever
// real message Supabase actually sent (e.g. "Database error saving new
// user" from a failing handle_new_user() trigger). Every other error class
// (400/422 validation errors like "already registered", wrong password,
// etc.) IS parsed correctly and error.message is reliable there — this only
// needs to special-case 5xx, so every supabase.auth.* call site can show
// something readable instead of "{}" for that one class of failure.
export function authErrorMessage(error: { message: string; status?: number }): string {
  if (error.status && error.status >= 500) {
    return "Something went wrong on our end. Please try again in a moment."
  }
  return error.message
}

// Supabase/PostgREST errors (the `error` half of `{ data, error }`) are
// plain objects, not real Error instances. Thrown as-is — the
// `if (error) throw error` pattern used across this API layer — they reach
// the browser as a raw object: Next's error overlay (and anything else
// that expects a thrown value to have a real .message, like
// react-query's own error surfacing) calls .toString() on it and gets
// "[object Object]", hiding the actual Postgres error entirely. This
// preserves the original error as `.cause` (so `.code`/`.details`/`.hint`
// are still inspectable in devtools) while giving callers a real,
// displayable `.message`.
// A readable cause for a failed database call — a PostgREST error object
// ({ code, message, details, hint }), one wrapped by wrapSupabaseError
// (.cause), or any Error. Permission (RLS), foreign-key and duplicate errors
// get plain wording; a trigger's own "raise exception" text (P0001) is shown
// as written, since that's already the reason in words.
export function describeDbError(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string; details?: string; hint?: string; cause?: unknown }
  const db = (e.cause && typeof e.cause === "object" ? e.cause : e) as { code?: string; message?: string; details?: string; hint?: string }
  const message = db.message || e.message || "Unknown error"
  switch (db.code) {
    case "42501":
      return `Permission denied — your account isn't allowed to make this change (${message})`
    case "23503":
      return `It refers to a record that doesn't exist (${db.details || message})`
    case "23505":
      return `That already exists (${db.details || message})`
    case "PGRST116":
      return "The record wasn't found, or your account can't see it"
    default:
      return [message, db.details, db.hint].filter(Boolean).join(" — ")
  }
}

// Logs a failed database call with everything Supabase returned (code,
// details, hint) for the browser console, under a short label.
export function logDbError(label: string, error: unknown): void {
  const e = (error ?? {}) as { cause?: unknown }
  console.error(`[${label}]`, e.cause && typeof e.cause === "object" ? e.cause : error)
}

export function wrapSupabaseError(error: { code?: string; message: string }): Error {
  return new Error(error.message, { cause: error })
}
