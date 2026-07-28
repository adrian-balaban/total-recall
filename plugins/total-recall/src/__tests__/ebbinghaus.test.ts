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

  it('confirmations boost retention and flags reduce it', () => {
    const base = computeRetentionStrength(0.5, 7, 0);
    const confirmed = computeRetentionStrength(0.5, 7, 0, 1, 0);
    const flagged = computeRetentionStrength(0.5, 7, 0, 0, 1);
    expect(confirmed).toBeGreaterThan(base);
    expect(flagged).toBeLessThan(base);
  });

  it('coerces negative confirmations/flags to zero', () => {
    expect(computeRetentionStrength(0.5, 7, 0, -5, -3)).toBe(
      computeRetentionStrength(0.5, 7, 0, 0, 0)
    );
  });

  it('11.1: falls back per-axis on non-finite inputs — no NaN propagates through the formula', () => {
    // The Number.isFinite guard at each axis (importance/days/access/confirmations/
    // flags) is the whole point: a hand-edited `importanceScore: NaN` (or a NaN
    // daysSince from a corrupt `updated` field) must fall back to a safe default
    // per axis instead of propagating NaN through Math.min/max and the exponential
    // into the final retention score (branch coverage gap GLM 7.1).
    expect(Number.isFinite(computeRetentionStrength(NaN, 0, 0))).toBe(true);
    expect(Number.isFinite(computeRetentionStrength(0.5, NaN, 0))).toBe(true);
    expect(Number.isFinite(computeRetentionStrength(0.5, 7, NaN))).toBe(true);
    expect(Number.isFinite(computeRetentionStrength(0.5, 7, 0, NaN, 0))).toBe(true);
    expect(Number.isFinite(computeRetentionStrength(0.5, 7, 0, 0, NaN))).toBe(true);
    expect(Number.isFinite(computeRetentionStrength(NaN, NaN, NaN, NaN, NaN))).toBe(true);
    // importance=NaN falls back to 0.5 at daysSince=0/accessCount=0 → strength ≈ 0.5
    expect(computeRetentionStrength(NaN, 0, 0)).toBeCloseTo(0.5, 1);
  });

  it('exact magnitude for a non-trivial (i,d,a,c,f) tuple — pins every constant', () => {
    // (importance=0.5, daysSince=10, accessCount=3, confirmations=2, flags=1)
    //   i = 0.5
    //   λ = 0.16 * (1 - 0.5 * 0.8) = 0.16 * 0.6 = 0.096
    //   boost = 1 + 3*0.2 + 2*0.1 - 1*0.1 = 1 + 0.6 + 0.2 - 0.1 = 1.7
    //   strength = 0.5 * exp(-0.096 * 10) * 1.7 = 0.5 * exp(-0.96) * 1.7
    //            ≈ 0.5 * 0.3828927078 * 1.7 ≈ 0.32545880
    // Every constant is non-zero in this tuple, so a mutant that swaps * for /,
    // flips a sign, or shifts a coefficient changes the result by ≫ 1e-4.
    expect(computeRetentionStrength(0.5, 10, 3, 2, 1)).toBeCloseTo(0.325459, 4);
  });

  it('accessCount multiplier is exactly +0.2 per access at zero decay', () => {
    // daysSince=0 collapses exp(0)=1, so strength = i * boost. With i=1:
    //   boost = 1 + a*0.2  (c=0, f=0)
    // a=0 → 1.0; a=1 → 1.2; a=5 → 2.0 (clamped to 1.0 by the final [0,1] clamp)
    expect(computeRetentionStrength(1, 0, 0, 0, 0)).toBeCloseTo(1.0);
    // a=1: 1 + 0.2 = 1.2 → clamped to 1.0, so use i=0.5 to stay unclamped:
    expect(computeRetentionStrength(0.5, 0, 1, 0, 0)).toBeCloseTo(0.5 * 1.2, 6);
    expect(computeRetentionStrength(0.5, 0, 3, 0, 0)).toBeCloseTo(0.5 * 1.6, 6);
  });

  it('confirmations multiplier is exactly +0.1 per confirmation at zero decay', () => {
    expect(computeRetentionStrength(0.5, 0, 0, 2, 0)).toBeCloseTo(0.5 * 1.2, 6);
    expect(computeRetentionStrength(0.5, 0, 0, 5, 0)).toBeCloseTo(0.5 * 1.5, 6);
  });

  it('flags multiplier is exactly -0.1 per flag at zero decay', () => {
    expect(computeRetentionStrength(0.5, 0, 0, 0, 1)).toBeCloseTo(0.5 * 0.9, 6);
    expect(computeRetentionStrength(0.5, 0, 0, 0, 3)).toBeCloseTo(0.5 * 0.7, 6);
  });

  it('λ scales with importance: higher importance decays slower', () => {
    // Same daysSince, same boost: a higher-importance memory retains more.
    // i=1.0 → λ=0.16*(1-0.8)=0.032; i=0.0 → λ=0.16*(1-0)=0.16
    const hi = computeRetentionStrength(1.0, 30, 0, 0, 0);
    const lo = computeRetentionStrength(0.0, 30, 0, 0, 0);
    // lo has importance 0 → strength 0 regardless of decay; use 0.5 vs 1.0
    // to keep both non-zero and isolate the λ effect:
    const mid = computeRetentionStrength(0.5, 30, 0, 0, 0);
    expect(hi).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(lo);
    // Exact: i=1.0, d=30, λ=0.032 → 1.0 * exp(-0.96) * 1.0
    expect(hi).toBeCloseTo(Math.exp(-0.032 * 30), 6);
    // i=0.5, d=30, λ=0.096 → 0.5 * exp(-2.88) * 1.0
    expect(mid).toBeCloseTo(0.5 * Math.exp(-0.096 * 30), 6);
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

  it('returns 0 for an invalid Date object, not the elapsed-since-epoch value', () => {
    // Pins the isNaN guard: a Date whose getTime() is NaN must short-circuit to
    // 0 BEFORE the subtraction runs. Date.now() is set to 2026-01-10 (non-zero),
    // so the only path to exactly 0 for an invalid date is the isNaN branch —
    // a mutant that drops the guard would compute (Date.now() - NaN)/86400000
    // = NaN, which is not === 0.
    expect(daysSince(new Date('not-a-date'))).toBe(0);
    // String form of the same invalid date — same guard, same path.
    expect(daysSince('invalid')).toBe(0);
  });
});
