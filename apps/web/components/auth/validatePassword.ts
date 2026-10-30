// What: Client-side password validator that mirrors the Supabase server-side
//       policy (minimum_password_length=8 + password_requirements=
//       lower_upper_letters_digits_symbols). Returns a user-facing error
//       string for the FIRST failing rule (progressive feedback) or null
//       when the password passes.
// Why: Without this, the user submits a non-compliant password and gets
//      a generic Supabase error after a network round-trip. Catching it
//      client-side gives instant feedback per failing rule, which is
//      friendlier than a single "use 8 chars, upper, lower, digit, symbol"
//      message every time. The composition rules MIRROR Supabase's exactly,
//      so a password that passes here always passes the server too —
//      friendlyAuthError covers the rare drift case (e.g. someone bypasses
//      the form and POSTs directly).
// Does NOT: Talk to Supabase, render anything, or check any policy beyond
//           the four standard categories. Lalista does not enforce a
//           denylist of common passwords; that's a v+ extension.

/** Lalista's password policy — pinned constants matching supabase/config.toml. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Validate a password against the lalista launch policy. Returns a friendly
 * error string for the first failing rule, or null on success. Order matters:
 * we check length first because it's the cheapest fix (just type more), then
 * each character class in lower → upper → digit → symbol order so the user's
 * keyboard motion roughly matches the next thing to add.
 */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters with a mix of uppercase, lowercase, a number, and a symbol.`;
  }
  if (!/[a-z]/.test(password)) {
    return 'Add at least one lowercase letter.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Add at least one uppercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Add at least one number.';
  }
  // Anything that's not [A-Za-z0-9] counts as a symbol. Matches Supabase's
  // `lower_upper_letters_digits_symbols` definition.
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return 'Add at least one symbol (e.g. !@#$%^&*).';
  }
  return null;
}
