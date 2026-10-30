// What: Smoke tests for the input-language heuristic
// Why: The same regex lives in the edge function; drift causes analytics
//      attribution to disagree with routing behavior
// Does NOT: Cover every Spanish indicator word — samples pick one per bucket

import { describe, expect, it } from 'vitest';
import { detectInputLanguage, isLikelyEnglish } from './inputLanguage';

describe('isLikelyEnglish', () => {
  it('returns true for obviously-English input', () => {
    expect(isLikelyEnglish('milk')).toBe(true);
    expect(isLikelyEnglish('add cheese')).toBe(true);
    expect(isLikelyEnglish('ziploc bags')).toBe(true);
  });

  it('returns false when any Spanish indicator word is present', () => {
    expect(isLikelyEnglish('leche')).toBe(false);
    expect(isLikelyEnglish('agrega queso')).toBe(false);
    // Whole-word match — `tomate` is on the list; `tomates` (plural) isn't.
    expect(isLikelyEnglish('dos tomate')).toBe(false);
  });

  it('is case-insensitive on the Spanish indicator', () => {
    expect(isLikelyEnglish('LECHE')).toBe(false);
    expect(isLikelyEnglish('Agrega Pan')).toBe(false);
  });

  it('does not misfire on English that happens to contain a substring', () => {
    // "pan" would be a Spanish match, but must be a whole-word match.
    expect(isLikelyEnglish('pancake')).toBe(true);
  });
});

describe('detectInputLanguage', () => {
  it('labels English inputs "en"', () => {
    expect(detectInputLanguage('milk')).toBe('en');
  });

  it('labels Spanish-indicator inputs "es"', () => {
    expect(detectInputLanguage('leche')).toBe('es');
  });
});
