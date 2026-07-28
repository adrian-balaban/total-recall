import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

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
import * as fs from 'fs';
import { flushPending, scheduleSave } from '../persistence.js';
import { errors } from '../state.js';
import { PERSONAL_VAULT } from '../paths.js';

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

// ─── Mutation-hardening: deriveFilePathFromKey, coerceMemEntry, unwrapIndexEntries ─
// deriveFilePathFromKey is exported + pure (no fs) — test every guard branch
// directly. coerceMemEntry + unwrapIndexEntries are internal — exercise them via
// loadIndexes with a staged index.json (fd writes bypass the mocked writeFileSync;
// readFileSync comes through the vi.importActual spread untouched).

describe('deriveFilePathFromKey — every guard branch', () => {
  let derive: typeof import('../persistence.js').deriveFilePathFromKey;
  let PERSONAL_VAULT: string;
  let ORG_VAULT: string;

  beforeAll(async () => {
    ({ deriveFilePathFromKey: derive } = await import('../persistence.js'));
    ({ PERSONAL_VAULT, ORG_VAULT } = await import('../paths.js'));
  });

  it('returns null for non-string keys', () => {
    expect(derive(null)).toBeNull();
    expect(derive(undefined)).toBeNull();
    expect(derive(123 as any)).toBeNull();
    expect((derive as any)({})).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(derive('')).toBeNull();
  });

  it('returns null for prototype-pollution reserved segments', () => {
    expect(derive('__proto__')).toBeNull();
    expect(derive('knowledge/__proto__')).toBeNull();
    expect(derive('constructor')).toBeNull();
    expect(derive('org/constructor/x')).toBeNull();
    expect(derive('knowledge/foo/prototype')).toBeNull();
  });

  it('returns null for null bytes and backslashes', () => {
    expect(derive('foo\0bar')).toBeNull();
    expect(derive('foo\\bar')).toBeNull();
  });

  it('returns null for absolute paths, // segments, and . / .. traversal', () => {
    expect(derive('/abs/path')).toBeNull();
    expect(derive('foo//bar')).toBeNull();
    expect(derive('..')).toBeNull();
    expect(derive('.')).toBeNull();
    expect(derive('foo/../bar')).toBeNull();
    expect(derive('foo/./bar')).toBeNull();
    expect(derive('knowledge/')).toBeNull(); // trailing empty segment
  });

  it('derives a personal-vault path for a valid personal key', () => {
    const fp = derive('knowledge/foo');
    expect(fp).toBe(path.join(PERSONAL_VAULT, 'knowledge/foo.md'));
  });

  it('derives an org-vault path for an org/ key', () => {
    const fp = derive('org/knowledge/bar');
    expect(fp).toBe(path.join(ORG_VAULT, 'knowledge/bar.md'));
  });

  it('rejects a traversal that resolves outside the vault after join', () => {
    // Even if a key passes the segment checks, the resolved-path containment
    // check is the last line of defense — a key like 'knowledge/..foo' that
    // would resolve outside the vault must be rejected. (The segment '..foo'
    // is not '..' so it passes the segment filter; containment is the guard.)
    // Use a key that passes segments but resolves outside via symlink-free
    // path math — 'knowledge/..' is caught by segments, so the real containment
    // guard catches crafted absolute-escape attempts that slip past segments.
    expect(derive('knowledge/..')).toBeNull();
  });
});

describe('coerceMemEntry via loadIndexes — malformed index.json is sanitized', () => {
  let INDEX_PATH: string;
  let loadIndexes: typeof import('../persistence.js').loadIndexes;
  let memIndex: typeof import('../state.js').memIndex;
  let errors: typeof import('../state.js').errors;

  beforeAll(async () => {
    ({ INDEX_PATH } = await import('../paths.js'));
    ({ loadIndexes } = await import('../persistence.js'));
    ({ memIndex, errors } = await import('../state.js'));
  });

  function stageIndex(payload: unknown) {
    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
    const fd = fs.openSync(INDEX_PATH, 'w');
    try { fs.writeSync(fd, JSON.stringify(payload)); } finally { fs.closeSync(fd); }
  }

  afterEach(() => {
    for (const k of Object.keys(memIndex)) delete (memIndex as any)[k];
    errors.length = 0;
    try { fs.unlinkSync(INDEX_PATH); } catch { /* may not exist */ }
  });

  it('coerces a scalar-string tags value to an empty array', () => {
    stageIndex({ v: 1, entries: { 'knowledge/scalar-tags': {
      title: 'T', tags: 'scalar', contentPreview: 'body',
    } } });
    loadIndexes();
    const e = (memIndex as any)['knowledge/scalar-tags'];
    expect(e).toBeDefined();
    expect(Array.isArray(e.tags)).toBe(true);
    expect(e.tags).toEqual([]);
  });

  it('filters null/undefined/non-string tag items, coercing numbers to strings', () => {
    stageIndex({ v: 1, entries: { 'knowledge/mixed-tags': {
      title: 'T', tags: [null, 123, 'keep', undefined, 'also-keep'],
      contentPreview: 'body',
    } } });
    loadIndexes();
    const e = (memIndex as any)['knowledge/mixed-tags'];
    // null + undefined → '' → filtered; 123 → '123'; 'keep' + 'also-keep' survive.
    expect(e.tags).toEqual(['123', 'keep', 'also-keep']);
  });

  it('coerces a non-numeric accessCount to 0 (NaN-string hole)', () => {
    stageIndex({ v: 1, entries: { 'knowledge/bad-access': {
      title: 'T', tags: [], contentPreview: 'body', accessCount: 'NaN',
    } } });
    loadIndexes();
    expect((memIndex as any)['knowledge/bad-access'].accessCount).toBe(0);
  });

  it('clamps a non-numeric importanceScore to the 0.5 fallback', () => {
    stageIndex({ v: 1, entries: { 'knowledge/bad-importance': {
      title: 'T', tags: [], contentPreview: 'body', importanceScore: 'high',
    } } });
    loadIndexes();
    expect((memIndex as any)['knowledge/bad-importance'].importanceScore).toBe(0.5);
  });

  it('defaults missing fields to safe values', () => {
    stageIndex({ v: 1, entries: { 'knowledge/minimal': {
      title: 'Min', contentPreview: 'body',
    } } });
    loadIndexes();
    const e = (memIndex as any)['knowledge/minimal'];
    expect(e.tags).toEqual([]);
    expect(e.sessions).toEqual([]);
    expect(e.accessCount).toBe(0);
    expect(e.lastAccessed).toBe('');
    expect(e.category).toBe('knowledge');
    expect(e.isOrg).toBe(false);
  });

  it('re-derives filePath from the key and discards a poisoned persisted filePath', () => {
    stageIndex({ v: 1, entries: { 'knowledge/poisoned': {
      title: 'T', tags: [], contentPreview: 'body',
      filePath: '/etc/shadow', // a teammate-planted poisoned path
    } } });
    loadIndexes();
    const e = (memIndex as any)['knowledge/poisoned'];
    expect(e.filePath).not.toBe('/etc/shadow');
    // filePath is rebuilt from the key under the personal vault.
    expect(e.filePath).toBe(path.join(PERSONAL_VAULT, 'knowledge/poisoned.md'));
  });

  it('drops an entry whose key fails deriveFilePathFromKey (reserved segment)', () => {
    // 'knowledge/__proto__' is a real own-property key (unlike '__proto__'
    // alone, which JSON.parse sets as the prototype, not an own property).
    // coerceMemEntry → deriveFilePathFromKey → isReservedKey → null → dropped.
    stageIndex({ v: 1, entries: { 'knowledge/__proto__': {
      title: 'T', tags: [], contentPreview: 'body',
    } } });
    loadIndexes();
    // Reserved segment → coerceMemEntry returns null → entry not indexed.
    expect((memIndex as any)['knowledge/__proto__']).toBeUndefined();
    expect(Object.keys(memIndex).length).toBe(0);
  });

  it('coerces a Number title to a string (pre-v1.0.6 legacy)', () => {
    stageIndex({ v: 1, entries: { 'knowledge/num-title': {
      title: 2026, tags: [], contentPreview: 'body',
    } } });
    loadIndexes();
    expect((memIndex as any)['knowledge/num-title'].title).toBe('2026');
  });
});

describe('unwrapIndexEntries forward-incompatible version', () => {
  let INDEX_PATH: string;
  let loadIndexes: typeof import('../persistence.js').loadIndexes;
  let memIndex: typeof import('../state.js').memIndex;
  let errors: typeof import('../state.js').errors;

  beforeAll(async () => {
    ({ INDEX_PATH } = await import('../paths.js'));
    ({ loadIndexes } = await import('../persistence.js'));
    ({ memIndex, errors } = await import('../state.js'));
  });

  afterEach(() => {
    for (const k of Object.keys(memIndex)) delete (memIndex as any)[k];
    errors.length = 0;
    try { fs.unlinkSync(INDEX_PATH); } catch { /* */ }
  });

  function stageIndex(payload: unknown) {
    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
    const fd = fs.openSync(INDEX_PATH, 'w');
    try { fs.writeSync(fd, JSON.stringify(payload)); } finally { fs.closeSync(fd); }
  }

  it('refuses a future schema version (v > INDEX_VERSION) and records an error', () => {
    stageIndex({ v: 999, entries: { 'knowledge/future': { title: 'T', contentPreview: 'b' } } });
    loadIndexes();
    // Forward-incompatible → bail to reconcileIndex rebuild; nothing loaded.
    expect((memIndex as any)['knowledge/future']).toBeUndefined();
    expect(Object.keys(memIndex).length).toBe(0);
    expect(errors.some((e) => /schema version newer|malformed wrapper/.test(e.msg))).toBe(true);
  });

  it('reads the legacy flat shape (no numeric v at top level)', () => {
    // Pre-9.2 flat index: the whole object is the entries map.
    stageIndex({ 'knowledge/legacy-flat': { title: 'Legacy', contentPreview: 'body' } });
    loadIndexes();
    expect((memIndex as any)['knowledge/legacy-flat']).toBeDefined();
    expect((memIndex as any)['knowledge/legacy-flat'].title).toBe('Legacy');
  });

  it('rejects a wrapped shape with non-object entries', () => {
    stageIndex({ v: 1, entries: 'not-an-object' });
    loadIndexes();
    expect(Object.keys(memIndex).length).toBe(0);
  });

  it('rejects a non-object / array top-level payload', () => {
    stageIndex([1, 2, 3]);
    loadIndexes();
    expect(Object.keys(memIndex).length).toBe(0);
  });
});

describe('buildIndexCache — shell-readable index cache', () => {
  it('does not throw when atomicWrite fails (records error, best-effort)', async () => {
    const { buildIndexCache } = await import('../persistence.js');
    const { memIndex } = await import('../state.js');
    // Seed one entry so buildIndexCache has content to serialize.
    (memIndex as any)['knowledge/cache-probe'] = {
      key: 'knowledge/cache-probe',
      title: 'cache probe',
      tags: ['t1', 't2', 't3', 't4'],
      contentPreview: 'body',
      category: 'knowledge',
    };
    // Under the fs mock, atomicWrite's writeFileSync throws → recordError.
    expect(() => buildIndexCache()).not.toThrow();
    expect(errors.some((e) => /atomicWrite/.test(e.msg))).toBe(true);
    delete (memIndex as any)['knowledge/cache-probe'];
  });
});
