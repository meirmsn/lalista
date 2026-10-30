// What: Unit tests for the validatePassword helper — pins the policy
//       (length + lowercase + uppercase + digit + symbol) and the order
//       in which failing rules surface.
// Why: validatePassword is the client-side mirror of Supabase's
//      lower_upper_letters_digits_symbols policy; if any of these rules
//      drift, friendlyAuthError covers the rare bypass case but the
//      typical UX path goes through this helper, so its behavior is
//      load-bearing for "the form said pass; the server agreed."
// Does NOT: Hit Supabase or test friendlyAuthError (that has its own
//           test file).

import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, validatePassword } from './validatePassword';

describe('validatePassword', () => {
  it('returns null on a fully compliant password', () => {
    expect(validatePassword('Password123!')).toBeNull();
  });

  it('flags too-short with the consolidated 8-char message', () => {
    const out = validatePassword('Pa1!');
    expect(out).toMatch(/at least 8 characters/i);
    expect(out).toMatch(/uppercase, lowercase, a number, and a symbol/i);
  });

  it('boundary: 7 chars fails (length), 8 chars + all classes passes', () => {
    expect(validatePassword('Pa1!abc')).toMatch(/at least 8/i);
    expect(validatePassword('Pa1!abcd')).toBeNull();
  });

  it('flags missing lowercase after length passes', () => {
    expect(validatePassword('PASSWORD123!')).toMatch(/lowercase/i);
  });

  it('flags missing uppercase', () => {
    expect(validatePassword('password123!')).toMatch(/uppercase/i);
  });

  it('flags missing digit', () => {
    expect(validatePassword('Password!!!')).toMatch(/number/i);
  });

  it('flags missing symbol', () => {
    expect(validatePassword('Password123')).toMatch(/symbol/i);
  });

  it('order: length → lowercase → uppercase → digit → symbol', () => {
    // Each fixture is failing the rule under test AND every later rule, so
    // we confirm the earlier rule wins.
    expect(validatePassword('AAA1!')).toMatch(/at least 8/i); // length wins
    expect(validatePassword('AAAA1!!!')).toMatch(/lowercase/i); // lower beats upper-pass + digit-pass + symbol-pass
    expect(validatePassword('aaaa1!!!')).toMatch(/uppercase/i); // upper wins
    expect(validatePassword('Aaaaaaaa!')).toMatch(/number/i); // number wins
    expect(validatePassword('Aaaaaaa1')).toMatch(/symbol/i); // symbol wins
  });

  it('treats any non-alphanumeric as a symbol (matches Supabase definition)', () => {
    for (const sym of ['!', '@', '#', '$', '%', '_', '-', ' ', '/', ':']) {
      expect(validatePassword(`Aaaaaa1${sym}`)).toBeNull();
    }
  });

  it('exports the length constant for re-use', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});
