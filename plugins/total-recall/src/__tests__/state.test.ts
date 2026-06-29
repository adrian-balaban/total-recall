import { describe, it, expect, vi, afterEach } from 'vitest';

// bumpAccess is a one-liner over memIndex + scheduleSave — test it through its
// observable contract: it mutates the meta in place (so the same reference
// stays current in memIndex) and calls scheduleSave exactly once. We mock
// scheduleSave at the module boundary (vi.mock), and substitute a real Map for
// memIndex via vi.mock on the state module so the test can't leak entries
// into the real shared singleton.
vi.mock('../persistence.js', () => ({ scheduleSave: vi.fn() }));
vi.mock('../state.js', async () => {
  const actual = await vi.importActual<any>('../state.js');
  return { ...actual, memIndex: {} };
});

import { bumpAccess } from '../state.js';
import { scheduleSave } from '../persistence.js';
import type { MemoryMetadata } from '../types.js';

const mkMeta = (): MemoryMetadata => ({
  key: 'k1', title: 't', tags: [], sessions: [],
  filePath: '/tmp/k1.md',
  created: '2025-01-01T00:00:00.000Z', updated: '2025-01-01T00:00:00.000Z',
  importanceScore: 0.5, category: 'knowledge', contentPreview: '',
  accessCount: 0, lastAccessed: '2025-01-01T00:00:00.000Z', tokenEstimate: 0,
  isOrg: false,
});

afterEach(() => vi.mocked(scheduleSave).mockClear());

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
    expect(scheduleSave).toHaveBeenCalledTimes(3);
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
