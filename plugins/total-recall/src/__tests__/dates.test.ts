import { describe, it, expect, afterEach, vi } from 'vitest';
import { inDateWindow, toCutoff, parseRelativeDate } from '../dates.js';

describe('inDateWindow', () => {
  // Fixtures: a stable window so the bounds-inclusive / bounds-exclusive edges
  // don't drift with wall-clock time. inDateWindow takes already-resolved Dates,
  // so no fake timers are needed.
  const lower = new Date('2026-06-20T00:00:00Z');
  const upper = new Date('2026-06-27T00:00:00Z');

  it('keeps an updated strictly inside the [lower, upper) window', () => {
    expect(inDateWindow('2026-06-24T12:00:00Z', lower, upper)).toBe(true);
  });

  it('keeps an updated exactly at lower (lower bound is inclusive, matches >=)', () => {
    // Old recall since-block: `new Date(updated) >= cutoff` — equal passes.
    expect(inDateWindow('2026-06-20T00:00:00Z', lower, upper)).toBe(true);
  });

  it('drops an updated exactly at upper (upper bound is exclusive, matches <)', () => {
    // Old recall before-block: `new Date(updated) < cutoff` — equal drops.
    expect(inDateWindow('2026-06-27T00:00:00Z', lower, upper)).toBe(false);
  });

  it('keeps an updated strictly below upper', () => {
    expect(inDateWindow('2026-06-26T23:59:59Z', lower, upper)).toBe(true);
  });

  it('drops an updated below lower', () => {
    expect(inDateWindow('2026-06-19T23:59:59Z', lower, upper)).toBe(false);
  });

  it('drops an updated above upper', () => {
    expect(inDateWindow('2026-06-28T00:00:00Z', lower, upper)).toBe(false);
  });

  it('respects a one-sided lower bound (upper=null)', () => {
    expect(inDateWindow('2026-06-25T00:00:00Z', lower, null)).toBe(true);
    expect(inDateWindow('2026-06-19T00:00:00Z', lower, null)).toBe(false);
  });

  it('respects a one-sided upper bound (lower=null)', () => {
    expect(inDateWindow('2026-06-25T00:00:00Z', null, upper)).toBe(true);
    expect(inDateWindow('2026-06-28T00:00:00Z', null, upper)).toBe(false);
  });

  it('treats both bounds null as unbounded (every present value passes)', () => {
    // The primitive is unbounded with no cutoffs — a PRESENT, valid `updated`
    // always passes (missing/invalid is handled by the strict guard, see the
    // next test). recall/searchIndex guard this path with `if (lower || upper)`
    // so the filter never runs when no bound is given (preserving the old
    // skip-both-blocks behavior); getTimeline never passes a null lower (epoch
    // default). Test the primitive directly here.
    expect(inDateWindow('2026-06-24T00:00:00Z', null, null)).toBe(true);
    expect(inDateWindow('2000-01-01T00:00:00Z', null, null)).toBe(true);
  });

  it('drops a missing updated whenever a bound is active (the silent-exclude rule)', () => {
    // Mirrors list_memories / recall_memory / search_index: a memory lacking
    // `updated` is dropped when a date filter is active (see CLAUDE.md "Key
    // Gotchas"). This is the whole point of the `if (!updated) return false`
    // guard — `new Date(undefined)` is Invalid and would otherwise compare
    // false via NaN, but the explicit guard short-circuits before that.
    expect(inDateWindow(undefined, lower, upper)).toBe(false);
    expect(inDateWindow(undefined, lower, null)).toBe(false);
    expect(inDateWindow(undefined, null, upper)).toBe(false);
    expect(inDateWindow('', lower, upper)).toBe(false); // empty string is falsy too
    expect(inDateWindow(null, lower, upper)).toBe(false);
  });

  it('drops a missing updated even with no bounds (primitive is strict: a non-date is never in any window)', () => {
    // The "no-filter keeps missing-`updated`" behavior of recall/searchIndex is
    // a property of their `if (lower || upper)` CALL-SITE guard — they skip the
    // filter entirely when no bound is given, so this primitive is never even
    // called with both-null in production (getTimeline passes an epoch default
    // for lower, so it never has both-null either). The primitive itself is
    // strict: a missing `updated` is never a valid date, so it is not "in" a
    // window — unbounded or otherwise — and returns false. This keeps the
    // contract simple and predictable; the call site owns the no-filter policy.
    expect(inDateWindow(undefined, null, null)).toBe(false);
  });

  it('drops an unparseable updated string (Invalid Date → NaN)', () => {
    // A non-empty but garbage `updated` (e.g. a teammate-pushed malformed
    // frontmatter) must be rejected, not crash the comparison. The isNaN guard
    // mirrors the old `new Date(garbage) >= cutoff` → false path.
    expect(inDateWindow('not-a-date', lower, upper)).toBe(false);
    expect(inDateWindow('not-a-date', null, null)).toBe(false);
  });
});

describe('toCutoff', () => {
  // Lightweight coverage for the bound resolver that inDateWindow's callers use;
  // the throw-on-bad-input contract is what makes the consolidated single-pass
  // filter safe (the throw point is unchanged from the old per-block calls).
  it('resolves a relative shorthand (7d) to ~now minus 7 days', () => {
    const cutoff = toCutoff('7d');
    const sevenDaysMs = 7 * 86400000;
    const age = Date.now() - cutoff.getTime();
    expect(age).toBeGreaterThan(sevenDaysMs - 1000);
    expect(age).toBeLessThan(sevenDaysMs + 1000);
  });

  it('resolves uppercase and padded relative shorthands (7D, 2W, " 1m ")', () => {
    const cutoffU = toCutoff('7D');
    const sevenDaysMs = 7 * 86400000;
    const age = Date.now() - cutoffU.getTime();
    expect(age).toBeGreaterThan(sevenDaysMs - 1000);
    expect(age).toBeLessThan(sevenDaysMs + 1000);

    expect(toCutoff(' 2w ').getTime()).toBeGreaterThan(0);
  });

  it('resolves an ISO date verbatim', () => {
    expect(toCutoff('2026-06-24').getTime()).toBe(new Date('2026-06-24').getTime());
  });

  it('throws on an unparseable bound (surfaces bad input instead of a silent empty result)', () => {
    expect(() => toCutoff('yesterday')).toThrow(/Invalid date filter/);
    expect(() => toCutoff('1y')).toThrow(/Invalid date filter/);
  });
});

// parseRelativeDate's unit ternary and its anchored regex were the weakest spot
// in dates.ts (75.93% mutation score): the existing shorthand test asserts a
// ~1s-tolerance window for '7d' and only `> 0` for '2w', so the week and month
// branches — and both regex anchors — could be mutated without any test
// noticing. Fake timers make Date.now() deterministic, which lets these assert
// EXACT offsets rather than tolerances.
describe('parseRelativeDate — units and anchoring', () => {
  const NOW = new Date('2026-06-24T12:00:00.000Z').getTime();
  const DAY = 86400000;
  afterEach(() => { vi.useRealTimers(); });

  function at(expr: string): number {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const d = parseRelativeDate(expr);
    if (!d) throw new Error(`expected ${expr} to parse`);
    return NOW - d.getTime();
  }

  it('resolves days as n × 86400000', () => {
    expect(at('7d')).toBe(7 * DAY);
    expect(at('1d')).toBe(DAY);
  });

  // Kills the week-branch mutants: `unit === 'w'` → true/false/!==/"" and
  // `n * 7 * 86400000` → `n * 7 / 86400000`.
  it('resolves weeks as n × 7 × 86400000, distinct from days', () => {
    expect(at('2w')).toBe(2 * 7 * DAY);
    expect(at('1w')).toBe(7 * DAY);
    expect(at('1w')).not.toBe(at('1d'));
  });

  // Kills the month-branch mutants: `n * 30 * 86400000` → `n * 30 / 86400000`
  // and `n / 30 * 86400000`.
  it('resolves months as n × 30 × 86400000, distinct from days and weeks', () => {
    expect(at('1m')).toBe(30 * DAY);
    expect(at('3m')).toBe(3 * 30 * DAY);
    expect(at('1m')).not.toBe(at('1w'));
  });

  it('parses a multi-digit count (kills \\d+ → \\d)', () => {
    expect(at('10d')).toBe(10 * DAY);
    expect(at('12w')).toBe(12 * 7 * DAY);
  });

  // Both anchors carry weight: without ^ a prefixed string would parse, without
  // $ a suffixed one would.
  it('rejects anything but a bare <count><unit> token', () => {
    expect(parseRelativeDate('x7d')).toBeNull();   // needs ^
    expect(parseRelativeDate('7dx')).toBeNull();   // needs $
    expect(parseRelativeDate('7 d')).toBeNull();
    expect(parseRelativeDate('7y')).toBeNull();
    expect(parseRelativeDate('d7')).toBeNull();
    expect(parseRelativeDate('')).toBeNull();
  });

  it('accepts surrounding whitespace and uppercase units', () => {
    expect(at(' 2W ')).toBe(2 * 7 * DAY);
    expect(at('3D')).toBe(3 * DAY);
  });
});
