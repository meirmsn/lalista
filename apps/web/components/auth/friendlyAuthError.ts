// What: Translates raw Supabase auth errors into user-facing copy
// Why: Raw messages are usable by devs ("Invalid login credentials") but
//      confusing in-product. Map the common cases; fall back to the raw
//      string so we never silently swallow an error.
// Does NOT: Talk to Supabase, render anything, or know about UI tokens.

const RATE_LIMIT = /email.*rate.*limit|rate.*limit.*email/i;
const NOT_CONFIRMED = /email.*not.*confirmed/i;
const ALREADY_REGISTERED = /user.*already.*registered/i;
const INVALID_CREDENTIALS = /invalid.*credentials/i;
// Matches both length-based ("Password should be at least N characters") and
// composition-based ("Password should contain at least one character of each:
// lowercase, uppercase, digits, symbols") errors that Supabase emits when
// minimum_password_length / password_requirements reject a submission.
const WEAK_PASSWORD =
  /password.*should.*be.*at.*least|password.*too.*short|weak.?password|password.*should.*contain.*at.*least.*one.*character.*of.*each|password.*does.*not.*meet|insufficient.*password|password.*is.*too.*weak/i;

/**
 * Predicate: did Supabase reject sign-in because email/password didn't match?
 * Exposed so callers can render the "trying to create an account instead?"
 * hint alongside the friendly error string — keeps the regex pinned to one
 * source of truth.
 */
export function isInvalidCredentialsError(message: string): boolean {
  return INVALID_CREDENTIALS.test(message);
}

/** Map a raw Supabase auth error message to user-facing copy. */
export function friendlyAuthError(message: string): string {
  if (RATE_LIMIT.test(message)) {
    return 'Too many attempts. Please try again in a few minutes.';
  }
  if (NOT_CONFIRMED.test(message)) {
    return 'Check your email to confirm your account first.';
  }
  if (ALREADY_REGISTERED.test(message)) {
    return 'That email is already registered. Try signing in instead.';
  }
  if (INVALID_CREDENTIALS.test(message)) {
    return 'That email and password don’t match. Check them and try again.';
  }
  if (WEAK_PASSWORD.test(message)) {
    return 'Use at least 8 characters with a mix of uppercase, lowercase, a number, and a symbol.';
  }
  return message;
}
