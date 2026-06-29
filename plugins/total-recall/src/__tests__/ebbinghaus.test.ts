import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeRetentionStrength, daysSince, clampImportanceScore } from '../ebbinghaus.js';

describe('computeRetentionStrength', () => {
  it('returns importance value when daysSince=0 and accessCount=0', () => {
    expect(computeRetentionStrength(1.0, 0, 0)).toBeCloseTo(1.0);
    expect(computeRetentionStrength(0.5, 0, 0)).toBeCloseTo(0.5);
  });

  it('caps at 1 even with high access count', () => {
    // min(1, 1.0 * exp(0) * (1 + 1000*0.2)) = min(1, 201) = 1
    const s = computeRetentionStrength(1.0, 0, 1000);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThan(0.99);
  });

  it('decays over time for a low-importance memory', () => {
    const fresh = computeRetentionStrength(0.3, 0, 0);
    const stale = computeRetentionStrength(0.3, 30, 0);
    expect(stale).toBeLessThan(fresh);
  });

  it('high importance decays slower than low importance over 10 days', () => {
    // High: λ=0.16*(1-0.9*0.8)=0.0448, strength = 0.9*exp(-0.448)*1 ≈ 0.575
    // Low:  λ=0.16*(1-0.2*0.8)=0.1344, strength = 0.2*exp(-1.344)*1 ≈ 0.052
    const high = computeRetentionStrength(0.9, 10, 0);
    const low  = computeRetentionStrength(0.2, 10, 0);
    expect(high).toBeGreaterThan(low);
  });

  it('access count boosts retention', () => {
    const noAccess   = computeRetentionStrength(0.5, 7, 0);
    const withAccess = computeRetentionStrength(0.5, 7, 5);
    expect(withAccess).toBeGreaterThan(noAccess);
  });

  it('approaches 0 for very old low-importance memories', () => {
    const s = computeRetentionStrength(0.1, 365, 0);
    expect(s).toBeLessThan(0.01);
  });

  it('never returns negative', () => {
    expect(computeRetentionStrength(0, 9999, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('clampImportanceScore', () => {
  it('passes through an in-range number', () => {
    expect(clampImportanceScore(0.7)).toBeCloseTo(0.7);
    expect(clampImportanceScore(0)).toBe(0);
    expect(clampImportanceScore(1)).toBe(1);
  });

  it('clamps values above 1 down to 1', () => {
    expect(clampImportanceScore(5)).toBe(1);
    expect(clampImportanceScore(1.0001)).toBe(1);
  });

  it('clamps negative values up to 0', () => {
    expect(clampImportanceScore(-1)).toBe(0);
    expect(clampImportanceScore(-0.01)).toBe(0);
  });

  it('accepts a quoted numeric string (teammate-pushed frontmatter)', () => {
    // `importanceScore: '0.7'` parses to a string; Number('0.7') is finite.
    expect(clampImportanceScore('0.7')).toBeCloseTo(0.7);
    // a quoted out-of-range value still clamps, matching the unquoted case.
    expect(clampImportanceScore('5')).toBe(1);
  });

  it('falls back to 0.5 for undefined / NaN / ±Infinity (the NaN hole)', () => {
    // `Math.min(1, NaN) === NaN` — the Number.isFinite guard is the point: a
    // non-numeric string like 'high' must fall back, not persist as NaN.
    expect(clampImportanceScore('high')).toBe(0.5);
    expect(clampImportanceScore(undefined)).toBe(0.5);
    expect(clampImportanceScore(NaN)).toBe(0.5);
    expect(clampImportanceScore(Infinity)).toBe(0.5);
    expect(clampImportanceScore(-Infinity)).toBe(0.5);
  });

  it('null coerces to 0 (Number(null) === 0, finite — NOT the fallback)', () => {
    expect(clampImportanceScore(null)).toBe(0);
  });

  it('honors a custom fallback for non-finite values', () => {
    expect(clampImportanceScore('high', 0.3)).toBe(0.3);
    expect(clampImportanceScore(NaN, 0.3)).toBe(0.3);
  });
});

describe('daysSince', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 for now', () => {
    expect(daysSince('2026-01-10T00:00:00Z')).toBeCloseTo(0, 5);
  });

  it('returns 7 for a week ago', () => {
    expect(daysSince('2026-01-03T00:00:00Z')).toBeCloseTo(7, 4);
  });

  it('returns ~30 for a month ago', () => {
    expect(daysSince('2025-12-11T00:00:00Z')).toBeCloseTo(30, 0);
  });

  it('accepts a Date object', () => {
    expect(daysSince(new Date('2026-01-09T00:00:00Z'))).toBeCloseTo(1, 5);
  });

  it('returns 0 for an invalid date string', () => {
    expect(daysSince('not-a-date')).toBe(0);
  });
});
