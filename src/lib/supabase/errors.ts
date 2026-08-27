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
