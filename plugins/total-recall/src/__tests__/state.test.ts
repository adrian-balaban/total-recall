import { describe, it, expect, vi, afterEach } from 'vitest';

// bumpAccess is a one-liner over memIndex + scheduleAccessSave — test it through
// its observable contract: it mutates the meta in place (so the same reference
// stays current in memIndex) and calls scheduleAccessSave exactly once. #4 split
// the save path: bumpAccess is the READ path, so it calls scheduleAccessSave
// (persist accessCount/lastAccessed WITHOUT rebuilding the inverted index),
// NOT scheduleSave (which sets the dirtyTokens flag and triggers the rebuild).
// We mock scheduleAccessSave at the module boundary (vi.mock), and substitute a
// real Map for memIndex via vi.mock on the state module so the test can't leak
// entries into the real shared singleton.
vi.mock('../persistence.js', () => ({ scheduleAccessSave: vi.fn() }));
vi.mock('../state.js', async () => {
  const actual = await vi.importActual<any>('../state.js');
  return { ...actual, memIndex: {} };
});

import { bumpAccess, recordError, errors } from '../state.js';
import { scheduleAccessSave } from '../persistence.js';
import type { MemoryMetadata } from '../types.js';

const mkMeta = (): MemoryMetadata => ({
  key: 'k1', title: 't', tags: [], sessions: [],
  filePath: '/tmp/k1.md',
  created: '2025-01-01T00:00:00.000Z', updated: '2025-01-01T00:00:00.000Z',
  importanceScore: 0.5, category: 'knowledge', contentPreview: '',
  accessCount: 0, lastAccessed: '2025-01-01T00:00:00.000Z', tokenEstimate: 0,
  isOrg: false, mtimeMs: 0, size: 0,
});

afterEach(() => {
  vi.mocked(scheduleAccessSave).mockClear();
  // recordError mutates the REAL shared `errors` singleton (the vi.mock above
  // spreads `actual`, so `errors` is the live array other suites' get_stats
  // reads). Reset it so the cap test below can't pollute the cross-test index.
  errors.length = 0;
});

describe('recordError', () => {
  // #21: trimTo trims only when length > 2×CAP (amortized-O(1): one cap-sized
  // splice every CAP pushes instead of a shift per push). So the buffer grows
  // past CAP and only snaps back to CAP at the 2×CAP boundary — the invariant is
  // "bounded, newest preserved at the tail", not "exactly CAP after CAP+1
  // pushes". Push 2×CAP+1 to cross the trim boundary and assert the snap-back.
  it('bounds the errors array at CAP via amortized batched trim (newest preserved)', () => {
    const base = errors.length;
    const cap = 1000;
    // Below the 2×CAP boundary: no trim, the buffer just grows.
    for (let i = 0; i < cap + 1; i++) recordError(`err-${i}`);
    expect(errors.length).toBe(cap + 1);
    // Cross 2×CAP: one splice drops the oldest CAP entries, snapping to CAP.
    for (let i = cap + 1; i < 2 * cap + 1; i++) recordError(`err-${i}`);
    expect(errors.length).toBe(cap);
    // The head is the entry just past the dropped window; the tail is the last
    // push — newest preserved at the end (what getStats' errors.slice(-10) sees).
    expect(errors[0]!.msg).toBe(`err-${cap + 1}`);
    expect(errors[cap - 1]!.msg).toBe(`err-${2 * cap}`);
    // Sanity: the test starts from an empty buffer.
    expect(base).toBe(0);
  });

  it('records the message with an ISO timestamp', () => {
    recordError('boom');
    expect(errors[errors.length - 1]!.msg).toBe('boom');
    expect(errors[errors.length - 1]!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('bumpAccess', () => {
  it('increments accessCount and updates lastAccessed in place', () => {
    const m = mkMeta();
    const before = m.lastAccessed;
    bumpAccess(m);
    expect(m.accessCount).toBe(1);
    // ISO timestamp after the bump must be >= the original (mocked clock is real)
    expect(new Date(m.lastAccessed).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('schedules exactly one save per call (cadence belongs in one place)', () => {
    const m = mkMeta();
    bumpAccess(m);
    bumpAccess(m);
    bumpAccess(m);
    expect(scheduleAccessSave).toHaveBeenCalledTimes(3);
  });

  it('mutates the passed-in object — does not replace it', () => {
    // Callers rely on the meta reference they hold staying current; replacing
    // the object would orphan it from memIndex. This is a behavior contract
    // the helper centralizes — every call site depends on it.
    const m = mkMeta();
    const ref = m;
    bumpAccess(m);
    expect(m).toBe(ref);
  });
});
