// What: Unit tests for friendlyAuthError — every regex branch + the fall-through
// Why: Each branch is a copy contract with the user. Regressions here regress
//      the auth surface; pin them.
// Does NOT: Network anything; pure-function input → output.

import { describe, expect, it } from 'vitest';
import { friendlyAuthError } from './friendlyAuthError';

describe('friendlyAuthError', () => {
  it('maps "Email rate limit exceeded" to the friendly copy', () => {
    expect(friendlyAuthError('Email rate limit exceeded')).toMatch(
      /too many attempts/i
    );
  });

  it('maps "rate limit ... email" variant', () => {
    expect(friendlyAuthError('over_email_send_rate_limit')).toMatch(
      /too many attempts/i
    );
  });

  it('maps "Email not confirmed" to the friendly copy', () => {
    expect(friendlyAuthError('Email not confirmed')).toMatch(
      /check your email to confirm/i
    );
  });

  it('maps "User already registered" to the sign-in nudge', () => {
    expect(friendlyAuthError('User already registered')).toMatch(
      /already registered.*try signing in/i
    );
  });

  it('maps "Invalid login credentials" to the email-and-password hint', () => {
    expect(friendlyAuthError('Invalid login credentials')).toMatch(
      /email and password don.?t match/i
    );
  });

  it('maps weak-password Supabase strings to the consolidated policy nudge', () => {
    expect(
      friendlyAuthError('Password should be at least 8 characters.')
    ).toMatch(/at least 8 characters/i);
    expect(friendlyAuthError('Weak password')).toMatch(/uppercase, lowercase/i);
    expect(
      friendlyAuthError(
        'Password should contain at least one character of each: lowercase, uppercase, digits, symbols'
      )
    ).toMatch(/uppercase, lowercase/i);
  });

  it('falls through unmapped messages verbatim', () => {
    expect(friendlyAuthError('something extremely specific')).toBe(
      'something extremely specific'
    );
  });
});
