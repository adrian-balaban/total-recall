import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// bumpAccess is the READ path: it mutates the entry in place and schedules a
// debounced index.json write WITHOUT the inverted-index rebuild (a read changes
// zero tokens). Asserted through observable behaviour: files on disk and the
// dirtyTokens-driven rebuild, not an internal call.

// persistence writes to fixed paths under the user's real ~/.total-recall.
// Redirect HOME to a tmp dir BEFORE any module import.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-access-' + process.pid;
});

vi.mock('../tfidf.js', async () => {
  const actual = await vi.importActual<typeof import('../tfidf.js')>('../tfidf.js');
  return { ...actual, rebuildInvertedIndex: vi.fn(actual.rebuildInvertedIndex) };
});

import { bumpAccess } from '../persistence.js';
import { rebuildInvertedIndex } from '../tfidf.js';
import { memIndex } from '../state.js';
import { INDEX_PATH, INVERTED_INDEX_PATH } from '../paths.js';
import * as fs from 'node:fs';

const KEY = 'knowledge/access-probe';

const mkMeta = (): any => ({
  key: KEY, title: 'access probe', tags: [], sessions: [],
  filePath: '/tmp/access-probe.md',
  created: '2025-01-01T00:00:00.000Z', updated: '2025-01-01T00:00:00.000Z',
  importanceScore: 0.5, category: 'knowledge', contentPreview: '',
  accessCount: 0, lastAccessed: '2025-01-01T00:00:00.000Z', tokenEstimate: 0,
  isOrg: false, mtimeMs: 0, size: 0,
});

const rm = () => {
  try { fs.rmSync(INDEX_PATH, { force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(INVERTED_INDEX_PATH, { force: true }); } catch { /* best-effort */ }
};

beforeEach(() => { vi.useFakeTimers(); rm(); });
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  delete (memIndex as any)[KEY];
  vi.mocked(rebuildInvertedIndex).mockClear();
  rm();
});

describe('bumpAccess', () => {
  it('increments accessCount and updates lastAccessed on the same object', () => {
    const m = mkMeta();
    const ref = m;
    const before = m.lastAccessed;
    bumpAccess(m);
    expect(m).toBe(ref);
    expect(m.accessCount).toBe(1);
    expect(m.lastAccessed).not.toBe(before);
    expect(new Date(m.lastAccessed).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('persists index.json after the 1s debounce, without an inverted-index rebuild', () => {
    const m = mkMeta();
    (memIndex as any)[KEY] = m;
    bumpAccess(m);
    expect(fs.existsSync(INDEX_PATH)).toBe(false);
    vi.advanceTimersByTime(999);
    expect(fs.existsSync(INDEX_PATH)).toBe(false);
    vi.advanceTimersByTime(1);
    const disk = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    expect(disk.entries[KEY].accessCount).toBe(1);
    // Read path: no token change, so no IDF recalc even well past the +2s window.
    vi.advanceTimersByTime(10_000);
    expect(rebuildInvertedIndex).not.toHaveBeenCalled();
    expect(fs.existsSync(INVERTED_INDEX_PATH)).toBe(false);
  });

  it('coalesces bumps inside the debounce window into one write', () => {
    const m = mkMeta();
    (memIndex as any)[KEY] = m;
    bumpAccess(m);
    vi.advanceTimersByTime(500);
    bumpAccess(m);
    vi.advanceTimersByTime(500);
    bumpAccess(m);
    // 1s after the FIRST bump, but the debounce was reset by the later ones.
    expect(fs.existsSync(INDEX_PATH)).toBe(false);
    vi.advanceTimersByTime(1000);
    // One write, carrying all three bumps.
    expect(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')).entries[KEY].accessCount).toBe(3);
  });
});
