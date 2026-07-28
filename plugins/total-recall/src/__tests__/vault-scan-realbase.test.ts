// Regression test for the realBaseFor null-caching self-heal contract.
//
// realBaseFor (src/vault-scan.ts) memoizes fs.realpathSync of each vault root
// per process. Its header comment promises "rebuilt if a root is seen null
// then later exists (e.g. ensureDir created it between scans)". The old code
// violated that contract: it cached the null result of a throwing realpath
// permanently (realBaseCache.set(base, null)), so a vault root whose FIRST
// realpath threw — a transient EACCES on a parent dir, the root vanishing
// mid-scan, or an FS that can't resolve it — was cached null for the entire
// process lifetime, and indexFile's `if (realBase === null) return` bailed on
// EVERY file in that vault forever. The fix caches ONLY non-null resolutions,
// re-resolving on each call while the value is null so a transient failure
// self-heals on the next scan.
//
// Why a dedicated file: the test needs to make fs.realpathSync throw on the
// FIRST resolution of PERSONAL_VAULT and succeed on the second. ESM namespace
// imports are non-configurable, so vi.spyOn(fs, 'realpathSync') throws — the
// only way to override a builtin is vi.mock('fs', importOriginal). That mock
// is file-wide, so isolating it here keeps the 48 real-fs tests in
// vault-scan-reconcile.test.ts (symlinks, chmod, readdir race) untouched.
// vectorStore + embeddings are mocked so reconcileVectors short-circuits and
// no sqlite-vec / HuggingFace model loads run.

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-realbase-' + process.pid;
});

// Mutable throw-once toggle, hoisted so the vi.mock('fs') factory (which runs
// before any test body) can close over it. Default 0 = pass-through; the test
// sets it to 1 so the NEXT base-root realpath throws exactly once, then resets.
const throwState = vi.hoisted(() => ({ baseThrowsRemaining: 0, baseTarget: '' as string }));

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('fs');
  return {
    ...actual,
    realpathSync: (p: fs.PathLike) => {
      if (String(p) === throwState.baseTarget && throwState.baseThrowsRemaining > 0) {
        throwState.baseThrowsRemaining -= 1;
        const err = new Error(`ENOENT: realpathSync '${String(p)}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return actual.realpathSync(p);
    },
  };
});

vi.mock('../vectorStore.js', () => ({
  listVectorKeys: async () => null,
  deleteVector: async () => {},
}));

vi.mock('../embeddings.js', () => ({
  embedAndUpsert: async () => {},
}));

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { indexFile, __testClearRealBaseCache } from '../vault-scan.js';
import { PERSONAL_VAULT } from '../paths.js';
import { memIndex } from '../state.js';
import { contentCache } from '../lru-cache.js';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-realbase-root-'));

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  for (const k of Object.keys(memIndex)) delete (memIndex as any)[k];
  fs.rmSync(PERSONAL_VAULT, { recursive: true, force: true });
  fs.mkdirSync(PERSONAL_VAULT, { recursive: true });
  // The module-level cache may already hold PERSONAL_VAULT from a prior test's
  // resolve; clear it so the mocked realpath is the FIRST resolver this run.
  __testClearRealBaseCache();
  throwState.baseThrowsRemaining = 0;
  throwState.baseTarget = '';
});

describe('realBaseFor — null is not cached (self-heal after a transient realpath failure)', () => {
  it('re-resolves a vault root that threw on the first call and indexes on the next', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'heal.md');
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '---\ntitle: "Heal"\ntags: [t]\n---\nheal body\n');

    // Arm: the very next realpathSync(PERSONAL_VAULT) throws exactly once.
    throwState.baseTarget = PERSONAL_VAULT;
    throwState.baseThrowsRemaining = 1;

    // Pass 1: realBaseFor calls realpathSync(PERSONAL_VAULT) → throws → returns
    // null. The fix does NOT cache null, so indexFile bails at the
    // `if (realBase === null) return` guard and the file is not indexed.
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/heal']).toBeUndefined();

    // Pass 2: throwState is now exhausted (0 remaining), so realpathSync
    // delegates to the real implementation and resolves PERSONAL_VAULT. With
    // the fix, realBaseFor re-resolves (null was not cached) → containment
    // passes → the file is indexed. With the bug (null cached permanently)
    // realBaseFor would return the cached null without calling realpathSync,
    // indexFile would bail again, and the entry would stay undefined → FAIL.
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/heal']).toBeDefined();
    expect((memIndex as any)['knowledge/heal'].title).toBe('Heal');

    contentCache.delete('knowledge/heal');
  });

  it('caches a successful resolution so a second file in the same vault skips realpath', () => {
    // The cache is keyed by vault root (PERSONAL_VAULT), not by file. Index a
    // first file with the throw disarmed: realBaseFor resolves PERSONAL_VAULT
    // successfully and caches it. Then arm the throw and index a SECOND file
    // in the same vault. The second file's slow path (new file → no `existing`
    // → no mtime/size fast-path skip) calls realBaseFor(PERSONAL_VAULT) again;
    // if the success was cached, realBaseFor returns the cached value WITHOUT
    // calling realpathSync, the throw is NOT consumed, and the second file
    // indexes. If the cache was broken (re-resolve every call), the second
    // realpath call would throw → bail → second file unindexed → FAIL.
    const fpA = path.join(PERSONAL_VAULT, 'knowledge', 'first.md');
    const fpB = path.join(PERSONAL_VAULT, 'knowledge', 'second.md');
    fs.mkdirSync(path.dirname(fpA), { recursive: true });
    fs.writeFileSync(fpA, '---\ntitle: "First"\n---\nbody a\n');
    fs.writeFileSync(fpB, '---\ntitle: "Second"\n---\nbody b\n');

    // Disarmed: first resolve succeeds and is cached.
    indexFile(fpA, false);
    expect((memIndex as any)['knowledge/first']).toBeDefined();

    // Arm: the NEXT realpathSync(PERSONAL_VAULT) would throw — but the cache
    // must prevent that call entirely for the second file.
    throwState.baseTarget = PERSONAL_VAULT;
    throwState.baseThrowsRemaining = 1;

    indexFile(fpB, false);
    expect((memIndex as any)['knowledge/second']).toBeDefined();
    expect((memIndex as any)['knowledge/second'].title).toBe('Second');
    // The throw was never consumed → realpathSync was never called for the
    // second file → the cached success was reused. Pins "one realpath per
    // root per process".
    expect(throwState.baseThrowsRemaining).toBe(1);

    contentCache.delete('knowledge/first');
    contentCache.delete('knowledge/second');
  });
});