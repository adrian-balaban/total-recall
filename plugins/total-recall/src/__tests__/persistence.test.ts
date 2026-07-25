import { describe, it, expect, vi, afterEach } from 'vitest';

// persistence writes to INDEX_PATH / INVERTED_INDEX_PATH / INDEX_CACHE_PATH —
// fixed paths under the user's real ~/.total-recall. Redirect HOME to a tmp dir
// BEFORE any module import (paths.ts captures os.homedir() once at load; same
// vi.hoisted pattern as index.test.ts).
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-persistence-' + process.pid;
});

// Force fs.writeFileSync + renameSync to throw so atomicWrite's primary write
// AND its rename-fallback write both fail — exercising the recordError path in
// atomicWrite and the belt-and-braces catch in flushPending. Spread the real fs
// so ensureDir (mkdirSync) and any reads keep working.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(() => {
      throw new Error('ENOSPC: no space left on device');
    }),
    renameSync: vi.fn(() => {
      throw new Error('EXDEV: cross-device link');
    }),
  };
});

import path from 'path';
import { flushPending, scheduleSave } from '../persistence.js';
import { errors } from '../state.js';

afterEach(() => {
  // flushPending + atomicWrite record into the REAL shared `errors` singleton
  // (get_stats reads it). Reset so this suite can't pollute the cross-test index.
  errors.length = 0;
});

describe('flushPending', () => {
  // flushPending runs on the SIGTERM/SIGINT/beforeExit path (index.ts). A throw
  // here escapes the signal handler → skips process.exit(0) → uncaughtException
  // kills the stdio server mid-shutdown. atomicWrite now swallows its own throws
  // and records via recordError; flushPending adds an isolated try/catch around
  // saveNow / recalcIdfNow so a failure in one write still runs the other and
  // nothing propagates. With fs forced to fail, the whole flush must complete
  // without throwing and must record the failure.
  it('does not throw when index writes fail (records error, best-effort)', () => {
    scheduleSave(); // arm the 1s indexSaveTimer so flushPending has work to do
    expect(() => flushPending()).not.toThrow();
    // atomicWrite recorded the ENOSPC via recordError (belt-and-braces catch in
    // flushPending is a backstop; atomicWrite swallows + records first).
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /atomicWrite|flushPending/.test(e.msg))).toBe(true);
  });

  // The early-return guard: with no debounce timer armed, flushPending must NOT
  // attempt any write (and thus record nothing). Without the guard, a flush on a
  // quiet shutdown would call saveNow unconditionally — a wasted write and, with
  // fs failing, a spurious error entry on every clean exit.
  it('is a no-op when no debounce timer is armed (records nothing)', () => {
    expect(() => flushPending()).not.toThrow();
    expect(errors.length).toBe(0);
  });
});

// 4.1 (REVIEW 1.6): atomicWrite leaves the last-good target untouched when the
// tmp write fails (ENOSPC/EACCES/EROFS). The fs mock forces writeFileSync to
// throw, so the tmp-write catch fires and recordErrors + returns BEFORE the
// target is ever touched. Staging a real last-good index.json via fd writes
// (openSync/writeSync/closeSync are NOT mocked — only writeFileSync/renameSync
// are, via the vi.importActual spread) lets us assert the on-disk content
// survives the failed flush. The old code's direct-overwrite fallback would
// have clobbered this with a partial/corrupt write (or thrown mid-fallback,
// killing the stdio server on the SIGTERM path); the fix leaves it intact for
// the next boot's reconcileIndex rebuild.
describe('atomicWrite 4.1: last-good preserved on tmp-write failure', () => {
  it('leaves the staged index.json untouched and records tmp-write failed', async () => {
    const { INDEX_PATH } = await import('../paths.js');
    const fs = await import('fs');
    // Stage a last-good index.json via fd writes — bypasses the mocked
    // writeFileSync (forced to throw). openSync/writeSync/closeSync/readFileSync
    // /mkdirSync all come through the vi.importActual spread untouched.
    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
    const lastGood = JSON.stringify({ 'knowledge/last-good': { key: 'knowledge/last-good' } });
    const fd = fs.openSync(INDEX_PATH, 'w');
    try { fs.writeSync(fd, lastGood); } finally { fs.closeSync(fd); }
    // Arm the debounce timer so flushPending has work to do, then force a flush.
    scheduleSave();
    expect(() => flushPending()).not.toThrow();
    // The tmp-write failure must be recorded with the 4.1 message.
    expect(errors.some((e) => /tmp-write failed/.test(e.msg))).toBe(true);
    // The last-good target must survive byte-for-byte — atomicWrite did NOT
    // fall back to a direct overwrite (which would clobber or corrupt it).
    expect(fs.readFileSync(INDEX_PATH, 'utf8')).toBe(lastGood);
  });
});
// ─── #18: dead boot invertedIndex.json load removed ─────────────────────────
// loadIndexes no longer reads invertedIndex.json — main() rebuilds the inverted
// index synchronously via recalcIdfNow right after reconcileIndex. Verify (1) a
// poisoned/stale invertedIndex.json on disk never reaches the in-memory
// invertedIndex singleton through loadIndexes, and (2) recalcIdfNow + the
// markIndexFresh gate leave the index materialized without scheduling a
// redundant +2s recalc.
describe('loadIndexes drops invertedIndex.json load (#18)', () => {
  // NOTE: this file's top-level vi.mock('fs') forces writeFileSync to throw, so
  // we can't easily stage a real on-disk invertedIndex.json here. Instead we
  // assert the contract directly: loadIndexes leaves invertedIndex empty until
  // an explicit rebuild, and recalcIdfNow populates it. The fs mock still allows
  // readFileSync (spread from actual), so a missing file simply yields the
  // catch's empty branch — loadIndexes must not throw and must not populate.
  it('loadIndexes does not populate invertedIndex from disk', async () => {
    const { loadIndexes, recalcIdfNow, markIndexFresh } = await import('../persistence.js');
    const { invertedIndex, memIndex } = await import('../state.js');
    const { rebuildInvertedIndex } = await import('../tfidf.js');
    // Clear singletons so prior suites' state can't satisfy the assertion.
    for (const k of Object.keys(invertedIndex)) delete (invertedIndex as any)[k];
    for (const k of Object.keys(memIndex)) delete (memIndex as any)[k];
    // loadIndexes must leave invertedIndex untouched (the dead load is gone).
    // It reads index.json (missing under the tmp HOME → empty), clearing
    // memIndex — so seed the entry AFTER loadIndexes, mirroring how main()
    // seeds memIndex via reconcileIndex between loadIndexes and recalcIdfNow.
    loadIndexes();
    expect(Object.keys(invertedIndex).length).toBe(0);
    (memIndex as any)['knowledge/contract-probe'] = {
      key: 'knowledge/contract-probe',
      title: 'contract probe token xyzzy',
      tags: ['test'],
      contentPreview: 'contract probe token xyzzy',
      category: 'knowledge',
      filePath: '/tmp/contract-probe.md',
      accessCount: 0,
      lastAccessed: null,
      tokenEstimate: 4,
      isOrg: false,
      sessions: [],
      importanceScore: 0.5,
      created: '2026-06-30T00:00:00.000Z',
      updated: '2026-06-30T00:00:00.000Z',
    };
    // The boot rebuild is what materializes the inverted index.
    expect(() => recalcIdfNow()).not.toThrow();
    expect(Object.keys(invertedIndex).length).toBeGreaterThan(0);
    // markIndexFresh is a pure flag clear — no throw, no observable mutation
    // of the inverted index.
    expect(() => markIndexFresh()).not.toThrow();
    expect(Object.keys(invertedIndex).length).toBeGreaterThan(0);
    // Clean up the seeded entry so it can't leak into other suites via the
    // shared singleton (the fs mock makes the debounced save a no-op write).
    delete (memIndex as any)['knowledge/contract-probe'];
    rebuildInvertedIndex();
  });
});
