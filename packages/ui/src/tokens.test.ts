import { describe, it, expect } from 'vitest';
import {
  breakpoints,
  colors,
  spacing,
  fonts,
  FEEDBACK_THRESHOLD_MS,
  RETRY_BUDGET_MS,
  RETRY_BACKOFF_MS,
} from './tokens';

describe('design tokens', () => {
  it('has all required breakpoints', () => {
    expect(breakpoints.sm).toBe(375);
    expect(breakpoints.md).toBe(768);
    expect(breakpoints.lg).toBe(1024);
    expect(breakpoints.xl).toBe(1440);
    expect(breakpoints['2xl']).toBe(2560);
  });

  it('has matching light and dark color keys', () => {
    const lightKeys = Object.keys(colors.light).sort();
    const darkKeys = Object.keys(colors.dark).sort();
    expect(lightKeys).toEqual(darkKeys);
  });

  it('uses 8px base spacing', () => {
    expect(spacing.sm).toBe('8px');
    expect(spacing.md).toBe('16px');
  });

  it('has display and body font families', () => {
    expect(fonts.display).toContain('Fraunces');
    expect(fonts.body).toContain('Plus Jakarta Sans');
  });

  it('pins motion/feedback tokens (drift detection — referenced from multiple call sites)', () => {
    expect(FEEDBACK_THRESHOLD_MS).toBe(250);
    expect(RETRY_BUDGET_MS).toBe(15000);
    expect(RETRY_BACKOFF_MS).toEqual([1000, 3000, 7000]);
    // RETRY_BACKOFF_MS sum + per-attempt RTT must fit RETRY_BUDGET_MS.
    const sum = RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThan(RETRY_BUDGET_MS);
  });
});
