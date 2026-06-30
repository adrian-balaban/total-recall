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
  // state.ts caps `errors` at 1000 (mirrors the perfSamples cap in server.ts).
  // A long-lived stdio server with a recurring error (misbehaving client hitting
  // an unknown tool, or a teammate-pushed malformed org file failing indexFile on
  // every reconcile) would otherwise grow `errors` without bound. get_stats only
  // returns the last 10, so the cap is invisible to consumers — but without it,
  // memory grows unbounded over a multi-day session.
  it('caps the errors array at 1000 entries (FIFO shift)', () => {
    const base = errors.length;
    for (let i = 0; i < 1001; i++) recordError(`err-${i}`);
    expect(errors.length).toBe(1000);
    // The oldest entry was shifted out; the array head is the 2nd-pushed entry
    // and the tail is the last-pushed.
    expect(errors[0]!.msg).toBe('err-1');
    expect(errors[999]!.msg).toBe('err-1000');
    // Sanity: exactly one entry was dropped relative to the 1001 pushes (+ base).
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
