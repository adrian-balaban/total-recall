import { describe, it, expect, vi, afterEach } from 'vitest';

// #4: flushPending unconditionally ran recalcIdfNow (a full rebuildInvertedIndex
// + invertedIndex.json write + cache rebuild) on EVERY exit — including a pure
// read-only session whose only pending timer was a scheduleAccessSave (an
// accessCount bump: zero token changes). The gate now skips recalc when neither
// dirtyTokens nor an idfTimer is queued, preserving the backstop only when
// tokens changed or a recalc was already scheduled.

// persistence writes to fixed paths under the user's real ~/.total-recall.
// Redirect HOME to a tmp dir BEFORE any module import (paths.ts captures
// os.homedir() once at load; same vi.hoisted pattern as persistence.test.ts).
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-readonly-flush-' + process.pid;
});

// Wrap rebuildInvertedIndex in a spy that still delegates to the real impl, so
// we can assert flushPending skips it on a read-only exit (and runs it when
// tokens changed) without disturbing the inverted index for other call sites.
vi.mock('../tfidf.js', async () => {
  const actual = await vi.importActual<typeof import('../tfidf.js')>('../tfidf.js');
  return {
    ...actual,
    rebuildInvertedIndex: vi.fn(actual.rebuildInvertedIndex),
  };
});

import { flushPending, scheduleAccessSave, scheduleSave, scheduleIdfRecalc } from '../persistence.js';
import { rebuildInvertedIndex } from '../tfidf.js';
import { memIndex } from '../state.js';

function seed(key: string) {
  (memIndex as any)[key] = {
    key,
    title: 'probe token xyzzy',
    tags: ['t'],
    contentPreview: 'probe token xyzzy',
    category: 'knowledge',
    filePath: '/tmp/' + key.replace('/', '-') + '.md',
    accessCount: 0,
    lastAccessed: null,
    tokenEstimate: 4,
    isOrg: false,
    sessions: [],
    importanceScore: 0.5,
    created: '2026-06-30T00:00:00.000Z',
    updated: '2026-06-30T00:00:00.000Z',
  };
}

afterEach(() => {
  vi.mocked(rebuildInvertedIndex).mockClear();
});

describe('flushPending read-only recalc gate (#4)', () => {
  // A read-only session's only pending timer is scheduleAccessSave (an
  // accessCount bump — zero token changes). dirtyTokens stays false and no
  // idfTimer is queued, so the gate must skip recalcIdfNow → rebuildInvertedIndex
  // must NOT run. saveNow still runs (it persists the access bump to index.json).
  it('skips rebuildInvertedIndex on a scheduleAccessSave-only exit', () => {
    seed('knowledge/readonly-probe');
    scheduleAccessSave(); // arms indexSaveTimer; leaves dirtyTokens false
    expect(() => flushPending()).not.toThrow();
    expect(rebuildInvertedIndex).not.toHaveBeenCalled();
    delete (memIndex as any)['knowledge/readonly-probe'];
  });

  // The backstop is preserved when it matters: a real token change (scheduleSave
  // after a store/update/delete) sets dirtyTokens, so the gate lets recalcIdfNow
  // run and rebuildInvertedIndex fires. Pins the gate's other arm so a future
  // "simplify flushPending" can't drop the recalc entirely.
  it('still runs rebuildInvertedIndex when tokens changed (scheduleSave)', () => {
    seed('knowledge/write-probe');
    scheduleSave(); // arms indexSaveTimer AND sets dirtyTokens = true
    expect(() => flushPending()).not.toThrow();
    expect(rebuildInvertedIndex).toHaveBeenCalled();
    delete (memIndex as any)['knowledge/write-probe'];
  });

  // T-F2 regression: the pre-fix code read `idfTimer !== null` AFTER setting
  // `idfTimer = null` (line 286 before 298), so `needRecalc` was always false
  // when `dirtyTokens` was also false — skipping recalcIdfNow even though a
  // recalc was queued. This window opens in the 1 second between the index.json
  // write (which fires scheduleIdfRecalc and clears dirtyTokens) and the +2s
  // IDF recalc itself. Pin the fix: when only idfTimer is armed (no dirtyTokens),
  // flushPending must still call rebuildInvertedIndex.
  it('still runs rebuildInvertedIndex when only idfTimer was queued (dirtyTokens=false)', () => {
    seed('knowledge/idf-pending-probe');
    // Arm only the idfTimer. scheduleIdfRecalc sets idfTimer without touching dirtyTokens.
    scheduleIdfRecalc();
    // dirtyTokens is false (no scheduleSave); idfTimer is set.
    // The pre-fix code: needRecalc = dirtyTokens || idfTimer !== null  (after idfTimer=null)
    //                 = false || null !== null = false  → skipped rebuild.
    // The fixed code:  needRecalc = dirtyTokens || idfWasQueued
    //                 = false || true = true  → runs rebuild.
    expect(() => flushPending()).not.toThrow();
    expect(rebuildInvertedIndex).toHaveBeenCalled();
    delete (memIndex as any)['knowledge/idf-pending-probe'];
  });
});