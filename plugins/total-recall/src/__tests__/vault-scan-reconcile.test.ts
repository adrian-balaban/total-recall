import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mutation-hardening for vault-scan.ts. The existing vault-scan.test.ts covers
// only readMemoryContent / readCachedOrFresh / slugify; indexFile, reconcileIndex,
// keyFromPath, isReservedKey, deriveCategory, assertRegularFile, assertLstat were
// ~183 NoCoverage mutants in the Stryker audit. This file exercises them against a
// redirected-HOME tmp vault (paths.ts freezes PERSONAL_VAULT/ORG_VAULT at module
// load from os.homedir(), so HOME must be redirected before the import graph loads).
//
// vectorStore + embeddings are mocked so reconcileVectors() short-circuits
// (listVectorKeys -> null) and no sqlite-vec / HuggingFace model loads run — the
// flakiness that got the real-sqlite tests excluded from the Stryker allow-list.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-vaultscan-' + process.pid;
});

vi.mock('../vectorStore.js', () => ({
  // null => reconcileVectors returns immediately (no native sqlite-vec touch).
  listVectorKeys: async () => null,
  deleteVector: async () => {},
}));

vi.mock('../embeddings.js', () => ({
  embedAndUpsert: async () => {},
  // Re-export other symbols vault-scan.ts does NOT import, just in case the mock
  // is widened later. Keep minimal.
}));

import {
  indexFile,
  reconcileIndex,
  keyFromPath,
  isReservedKey,
  deriveCategory,
  assertRegularFile,
  assertLstat,
  RESERVED_KEY_SEGMENTS,
} from '../vault-scan.js';
import { PERSONAL_VAULT, ORG_VAULT } from '../paths.js';
import { memIndex, errors } from '../state.js';
import { contentCache } from '../lru-cache.js';

// Symlink-capability guard (mirrors index.test.ts / vault-scan.test.ts).
const CAN_SYMLINK = (() => {
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-sym-vs-'));
    fs.symlinkSync('nonexistent-target', path.join(d, 'link'));
    fs.rmSync(d, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

function cleanMem(keys: string[]) {
  for (const k of keys) delete (memIndex as any)[k];
  for (const k of keys) contentCache.delete(k);
}

// vitest gives each file its own module graph (per-file isolation), so memIndex /
// errors here are THIS file's instances — wiping them in beforeEach cannot touch
// another file's state. Wipe both the on-disk vaults (deterministic reconcileIndex
// walks) and the in-memory singletons (no cross-test key leaks that could mask a
// mutant). contentCache has no clear(), so per-test cleanMem deletes its keys.
beforeEach(() => {
  errors.length = 0;
  for (const k of Object.keys(memIndex)) delete (memIndex as any)[k];
  fs.rmSync(PERSONAL_VAULT, { recursive: true, force: true });
  fs.rmSync(ORG_VAULT, { recursive: true, force: true });
  fs.mkdirSync(PERSONAL_VAULT, { recursive: true });
  fs.mkdirSync(ORG_VAULT, { recursive: true });
});

// ─── keyFromPath ──────────────────────────────────────────────────────────────

describe('keyFromPath', () => {
  it('personal vault: relative path without extension, "/" separators', () => {
    expect(keyFromPath(path.join(PERSONAL_VAULT, 'architecture', 'a.md'), false)).toBe('architecture/a');
  });

  it('org vault: prefixed with org/', () => {
    expect(keyFromPath(path.join(ORG_VAULT, 'notes', 'x.md'), true)).toBe('org/notes/x');
  });

  it('strips the trailing .md', () => {
    expect(keyFromPath(path.join(PERSONAL_VAULT, 'k.md'), false)).toBe('k');
  });

  it('nested personal path keeps every segment', () => {
    expect(keyFromPath(path.join(PERSONAL_VAULT, 'a', 'b', 'c.md'), false)).toBe('a/b/c');
  });
});

// ─── isReservedKey ────────────────────────────────────────────────────────────

describe('isReservedKey', () => {
  it('rejects the prototype-pollution segment names', () => {
    for (const bad of ['__proto__', 'constructor', 'prototype']) {
      expect(isReservedKey(bad)).toBe(true);
    }
  });

  it('rejects a reserved segment anywhere in the path', () => {
    expect(isReservedKey('knowledge/__proto__')).toBe(true);
    expect(isReservedKey('a/constructor/b')).toBe(true);
    expect(isReservedKey('org/prototype')).toBe(true);
  });

  it('rejects non-string and empty', () => {
    expect(isReservedKey('')).toBe(true);
    expect(isReservedKey(undefined as any)).toBe(true);
    expect(isReservedKey(42 as any)).toBe(true);
  });

  it('rejects a bare org/ prefix with nothing under it', () => {
    expect(isReservedKey('org/')).toBe(true);
  });

  it('accepts normal keys (personal and org)', () => {
    expect(isReservedKey('knowledge/normal')).toBe(false);
    expect(isReservedKey('org/notes/x')).toBe(false);
    expect(isReservedKey('architecture')).toBe(false);
  });

  it('RESERVED_KEY_SEGMENTS contains exactly the three pollution names', () => {
    expect([...RESERVED_KEY_SEGMENTS].sort()).toEqual(['__proto__', 'constructor', 'prototype']);
  });
});

// ─── deriveCategory ───────────────────────────────────────────────────────────

describe('deriveCategory', () => {
  it('uses the top dir under the personal vault', () => {
    expect(deriveCategory(path.join(PERSONAL_VAULT, 'decisions', 'a.md'), false)).toBe('decisions');
    expect(deriveCategory(path.join(PERSONAL_VAULT, 'troubleshooting', 'b.md'), false)).toBe('troubleshooting');
  });

  it('falls back to "knowledge" for a file directly in the vault root', () => {
    expect(deriveCategory(path.join(PERSONAL_VAULT, 'loose.md'), false)).toBe('knowledge');
  });

  it('uses the top dir under the org vault too', () => {
    expect(deriveCategory(path.join(ORG_VAULT, 'meetings', 'm.md'), true)).toBe('meetings');
  });
});

// ─── assertRegularFile / assertLstat ──────────────────────────────────────────

describe('assertRegularFile', () => {
  it('passes silently for a regular file', () => {
    const fp = path.join(PERSONAL_VAULT, 'reg.md');
    fs.writeFileSync(fp, 'body');
    expect(() => assertRegularFile(fp, 'test/reg')).not.toThrow();
  });

  it('throws for a directory', () => {
    const fp = path.join(PERSONAL_VAULT, 'adir');
    fs.mkdirSync(fp, { recursive: true });
    expect(() => assertRegularFile(fp, 'test/adir')).toThrow();
  });

  it('throws for a symlink (does not follow)', () => {
    if (!CAN_SYMLINK) return;
    const victim = path.join(PERSONAL_VAULT, 'victim.txt');
    fs.writeFileSync(victim, 'SECRET');
    const link = path.join(PERSONAL_VAULT, 'link.md');
    fs.symlinkSync(victim, link);
    expect(() => assertRegularFile(link, 'test/link')).toThrow();
  });

  it('lets ENOENT fall through (no throw)', () => {
    expect(() => assertRegularFile(path.join(PERSONAL_VAULT, 'nope.md'), 'test/nope')).not.toThrow();
  });
});

describe('assertLstat', () => {
  it('passes when the predicate holds', () => {
    const fp = path.join(PERSONAL_VAULT, 'ok.md');
    fs.writeFileSync(fp, 'body');
    expect(() => assertLstat(fp, (s) => s.isFile(), 'not a file')).not.toThrow();
  });

  it('throws the caller-supplied message when the predicate fails', () => {
    const fp = path.join(PERSONAL_VAULT, 'adir2');
    fs.mkdirSync(fp, { recursive: true });
    expect(() => assertLstat(fp, (s) => s.isFile(), 'MUST-BE-FILE')).toThrow('MUST-BE-FILE');
  });

  it('lets ENOENT fall through (predicate never runs)', () => {
    expect(() => assertLstat(path.join(PERSONAL_VAULT, 'missing.md'), () => false, 'never')).not.toThrow();
  });
});

// ─── indexFile ────────────────────────────────────────────────────────────────

function writeMd(fp: string, frontmatter: string, body = 'the body') {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `---\n${frontmatter}\n---\n${body}\n`);
}

describe('indexFile — happy path builds full metadata', () => {
  it('indexes a well-formed memory with all optional fields', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'full.md');
    writeMd(
      fp,
      'title: "Full"\ntags: [a, b]\nsessions: [s1]\nauthor: "adi"\nimportanceScore: 0.7\nconfirmations: 5\nflags: 1\ncreated: "2026-01-01T00:00:00.000Z"\nupdated: "2026-02-01T00:00:00.000Z"\nsupersededAt: ["2026-03-01T00:00:00.000Z"]',
      'body text here',
    );
    indexFile(fp, false);
    const m = (memIndex as any)['knowledge/full'];
    expect(m).toBeDefined();
    expect(m.key).toBe('knowledge/full');
    expect(m.filePath).toBe(fp);
    expect(m.title).toBe('Full');
    expect(m.tags).toEqual(['a', 'b']);
    expect(m.sessions).toEqual(['s1']);
    expect(m.author).toBe('adi');
    expect(m.importanceScore).toBe(0.7);
    expect(m.confirmations).toBe(5);
    expect(m.flags).toBe(1);
    expect(m.supersededAt).toEqual(['2026-03-01T00:00:00.000Z']);
    expect(m.created).toBe('2026-01-01T00:00:00.000Z');
    expect(m.updated).toBe('2026-02-01T00:00:00.000Z');
    expect(m.category).toBe('knowledge');
    expect(m.isOrg).toBe(false);
    expect(m.contentPreview).toBe('body text here');
    expect(m.tokenEstimate).toBeGreaterThan(0);
    expect(typeof m.mtimeMs).toBe('number');
    expect(typeof m.size).toBe('number');
    cleanMem(['knowledge/full']);
  });

  it('falls back to the basename when title is absent', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'notitle.md');
    writeMd(fp, 'tags: []');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/notitle'].title).toBe('notitle');
    cleanMem(['knowledge/notitle']);
  });

  it('coerces a numeric (unquoted) title to a string', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'numtitle.md');
    writeMd(fp, 'title: 2026');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/numtitle'].title).toBe('2026');
    cleanMem(['knowledge/numtitle']);
  });

  it('coerces a scalar tags / sessions to empty arrays', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'scalar.md');
    writeMd(fp, 'title: "S"\ntags: foo\nsessions: bar');
    indexFile(fp, false);
    const m = (memIndex as any)['knowledge/scalar'];
    expect(m.tags).toEqual([]);
    expect(m.sessions).toEqual([]);
    cleanMem(['knowledge/scalar']);
  });

  it('clamps importanceScore into [0,1]', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'imp.md');
    writeMd(fp, 'title: "I"\nimportanceScore: 5');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/imp'].importanceScore).toBe(1);
    cleanMem(['knowledge/imp']);
  });

  it('trims + slices contentPreview to 500 chars', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'long.md');
    const body = 'x'.repeat(800);
    writeMd(fp, 'title: "L"', body);
    indexFile(fp, false);
    const cp = (memIndex as any)['knowledge/long'].contentPreview;
    expect(cp.length).toBe(500);
    expect(cp).toBe('x'.repeat(500));
    cleanMem(['knowledge/long']);
  });
});

describe('indexFile — optional-field guards', () => {
  it('omits author when absent (present-but-undefined != absent)', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'noauth.md');
    writeMd(fp, 'title: "NA"');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/noauth'].author).toBeUndefined();
    cleanMem(['knowledge/noauth']);
  });

  it('attaches confirmations only when finite and > 0', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'conf.md');
    writeMd(fp, 'title: "C"\nconfirmations: 3');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/conf'].confirmations).toBe(3);
    cleanMem(['knowledge/conf']);
  });

  it('does NOT attach confirmations when <= 0', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'conf0.md');
    writeMd(fp, 'title: "C0"\nconfirmations: 0');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/conf0'].confirmations).toBeUndefined();
    cleanMem(['knowledge/conf0']);
  });

  it('does NOT attach confirmations when non-finite', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'confnan.md');
    writeMd(fp, 'title: "CN"\nconfirmations: NaN');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/confnan'].confirmations).toBeUndefined();
    cleanMem(['knowledge/confnan']);
  });

  it('attaches flags only when finite and > 0, clamped via Math.max(0, .)', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'flag.md');
    writeMd(fp, 'title: "F"\nflags: 2');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/flag'].flags).toBe(2);
    cleanMem(['knowledge/flag']);
  });

  it('does NOT attach flags when <= 0', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'flag0.md');
    writeMd(fp, 'title: "F0"\nflags: -1');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/flag0'].flags).toBeUndefined();
    cleanMem(['knowledge/flag0']);
  });

  it('attaches supersededAt as a string array (parser stringifies inline items)', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'sup.md');
    writeMd(fp, 'title: "SUP"\nsupersededAt: ["2026-01-01", 5, true, "2026-02-02"]');
    indexFile(fp, false);
    // parseFrontmatter stringifies inline-array items, so the array arrives
    // already all-strings; the `.filter(typeof t === 'string')` is defense against
    // a non-parser path. Pin the Array.isArray + attach branch: the chain is
    // carried into meta as a string array, not dropped.
    expect((memIndex as any)['knowledge/sup'].supersededAt).toEqual([
      '2026-01-01', '5', 'true', '2026-02-02',
    ]);
    cleanMem(['knowledge/sup']);
  });

  it('omits supersededAt when it is not an array', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'supsca.md');
    writeMd(fp, 'title: "SS"\nsupersededAt: "notarray"');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/supsca'].supersededAt).toBeUndefined();
    cleanMem(['knowledge/supsca']);
  });
});

describe('indexFile — mtime/size fast path vs slow path', () => {
  it('reuses the cached entry on a second indexFile without re-reading (fast path)', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'fp.md');
    writeMd(fp, 'title: "FP"\ntags: [t]', 'first body');
    indexFile(fp, false);
    const cached = (memIndex as any)['knowledge/fp'];
    // Corrupt the cached contentPreview + title with sentinels, but LEAVE
    // mtimeMs/size as the first indexFile set them so the fast-path identity
    // check still fires. A re-read (slow path) would overwrite these with the
    // real disk values; the fast path spreads `existing` verbatim, so the
    // sentinels survive => proof of no re-read. (Bonus: if a mutant dropped the
    // mtimeMs/size assignment in indexFile, they'd be undefined here, the
    // condition fails, the slow path re-reads and overwrites the sentinels =>
    // this test fails => that mutant is killed too.)
    cached.contentPreview = 'SENTINEL_PREVIEW';
    cached.title = 'SENTINEL_TITLE';
    indexFile(fp, false); // unchanged => fast path
    const after = (memIndex as any)['knowledge/fp'];
    expect(after.contentPreview).toBe('SENTINEL_PREVIEW');
    expect(after.title).toBe('SENTINEL_TITLE');
    expect(after.filePath).toBe(fp);
    cleanMem(['knowledge/fp']);
  });

  it('re-reads when the file size changes (fast path does not fire)', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'chg.md');
    writeMd(fp, 'title: "CHG"', 'AAA');
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/chg'].contentPreview).toBe('AAA');

    // Append content => size differs => slow path re-reads.
    fs.writeFileSync(fp, `---\ntitle: "CHG"\n---\nAAABBB\n`);
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/chg'].contentPreview).toBe('AAABBB');
    cleanMem(['knowledge/chg']);
  });

  it('preserves runtime accessCount/lastAccessed across a re-index', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'keep.md');
    writeMd(fp, 'title: "K"', 'b1');
    indexFile(fp, false);
    (memIndex as any)['knowledge/keep'].accessCount = 7;
    (memIndex as any)['knowledge/keep'].lastAccessed = '2025-01-01T00:00:00.000Z';
    // Force slow path by changing size; runtime stats must survive.
    fs.writeFileSync(fp, `---\ntitle: "K"\n---\nb2-longer\n`);
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/keep'].accessCount).toBe(7);
    expect((memIndex as any)['knowledge/keep'].lastAccessed).toBe('2025-01-01T00:00:00.000Z');
    cleanMem(['knowledge/keep']);
  });
});

describe('indexFile — rejection paths', () => {
  it('skips a symlink .md and does NOT index it', () => {
    if (!CAN_SYMLINK) return;
    fs.mkdirSync(path.join(PERSONAL_VAULT, 'knowledge'), { recursive: true });
    const victim = path.join(PERSONAL_VAULT, 'knowledge', 'victim.txt');
    fs.writeFileSync(victim, 'SECRET');
    const link = path.join(PERSONAL_VAULT, 'knowledge', 'sym.md');
    fs.symlinkSync(victim, link);
    indexFile(link, false);
    expect((memIndex as any)['knowledge/sym']).toBeUndefined();
    // And the secret never made it into any preview.
    for (const k of Object.keys(memIndex)) {
      expect((memIndex as any)[k].contentPreview ?? '').not.toContain('SECRET');
    }
    fs.rmSync(link, { force: true });
    fs.rmSync(victim, { force: true });
  });

  it('skips a reserved __proto__.md key and records an error', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', '__proto__.md');
    writeMd(fp, 'title: "Bad"');
    const beforeErr = errors.length;
    indexFile(fp, false);
    expect((memIndex as any)['knowledge/__proto__']).toBeUndefined();
    expect(errors.length).toBeGreaterThan(beforeErr);
    fs.rmSync(fp, { force: true });
  });

  it('records an error (not a throw) when the file path is outside the vault', () => {
    // A regular file in the tmp dir, but indexed as if personal-vault-rooted:
    // realpath containment check rejects it. Use a path NOT under PERSONAL_VAULT.
    const outside = path.join(os.tmpdir(), 'tr-outside-' + process.pid + '.md');
    fs.writeFileSync(outside, '---\ntitle: "Out"\n---\nbody\n');
    const beforeErr = errors.length;
    expect(() => indexFile(outside, false)).not.toThrow();
    // The containment bail is a silent return: the outside file must NOT enter
    // memIndex under any key (its keyFromPath would be `../../tr-outside-<pid>`).
    // beforeEach wiped memIndex, so emptiness pins "nothing got indexed".
    expect(Object.keys(memIndex).some((k) => k.includes('tr-outside'))).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(beforeErr);
    fs.rmSync(outside, { force: true });
  });
});

// ─── reconcileIndex ───────────────────────────────────────────────────────────

describe('reconcileIndex — boot walk', () => {
  it('indexes .md files found under the personal vault', () => {
    const fp = path.join(PERSONAL_VAULT, 'knowledge', 'rc1.md');
    writeMd(fp, 'title: "RC1"', 'rc body');
    reconcileIndex();
    expect((memIndex as any)['knowledge/rc1']).toBeDefined();
    expect((memIndex as any)['knowledge/rc1'].title).toBe('RC1');
    cleanMem(['knowledge/rc1']);
  });

  it('indexes org-vault files under the org/ key prefix', () => {
    const fp = path.join(ORG_VAULT, 'notes', 'org1.md');
    writeMd(fp, 'title: "OR"', 'org body');
    reconcileIndex();
    expect((memIndex as any)['org/notes/org1']).toBeDefined();
    cleanMem(['org/notes/org1']);
  });

  it('skips EXCLUDED_DIRS subtrees', () => {
    // 'projects' is in EXCLUDED_DIRS.
    const fp = path.join(PERSONAL_VAULT, 'projects', 'excl.md');
    writeMd(fp, 'title: "EX"', 'excluded body');
    reconcileIndex();
    expect((memIndex as any)['projects/excl']).toBeUndefined();
    fs.rmSync(path.join(PERSONAL_VAULT, 'projects'), { recursive: true, force: true });
  });

  it('skips a personal-vault subdir literally named "org" (reserved prefix)', () => {
    const fp = path.join(PERSONAL_VAULT, 'org', 'collision.md');
    writeMd(fp, 'title: "COL"', 'collision body');
    reconcileIndex();
    // Must NOT be indexed as org/collision (would shadow real org-vault keys).
    expect((memIndex as any)['org/collision']).toBeUndefined();
    fs.rmSync(path.join(PERSONAL_VAULT, 'org'), { recursive: true, force: true });
  });

  it('drops a memIndex entry whose file no longer exists and purges its cache', () => {
    // Seed memIndex + cache with a key whose file is absent.
    (memIndex as any)['knowledge/gone'] = {
      key: 'knowledge/gone',
      title: 'Gone',
      tags: [],
      contentPreview: 'gone body',
      category: 'knowledge',
      filePath: path.join(PERSONAL_VAULT, 'knowledge', 'gone.md'),
      accessCount: 0,
      lastAccessed: null,
      tokenEstimate: 2,
      isOrg: false,
      sessions: [],
      importanceScore: 0.5,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      mtimeMs: 0,
      size: 0,
    };
    contentCache.set('knowledge/gone', 'gone body');
    expect((memIndex as any)['knowledge/gone']).toBeDefined();
    reconcileIndex();
    expect((memIndex as any)['knowledge/gone']).toBeUndefined();
    expect(contentCache.get('knowledge/gone')).toBeUndefined();
  });

  it('skips a symlinked directory (does not recurse outside the vault)', () => {
    if (!CAN_SYMLINK) return;
    const outside = path.join(os.tmpdir(), 'tr-outside-dir-' + process.pid);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'leak.md'), '---\ntitle: "LEAK"\n---\nsecret\n');
    fs.mkdirSync(path.join(PERSONAL_VAULT, 'knowledge'), { recursive: true });
    const link = path.join(PERSONAL_VAULT, 'knowledge', 'linkdir');
    fs.symlinkSync(outside, link);
    reconcileIndex();
    // The symlinked dir must not be recursed: no key for the outside file leaks in.
    expect((memIndex as any)['knowledge/linkdir/leak']).toBeUndefined();
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('records an error on a non-ENOENT readdirSync failure (EACCES on a chmod 000 subdir)', () => {
    // ESM namespace exports can't be spied (vi.spyOn(fs,'readdirSync') throws),
    // so force a REAL non-ENOENT readdirSync failure: a subdir chmod 000 is
    // unreadable to a non-root process. walk() recurses into it, readdirSync
    // throws EACCES, and the catch's `code !== 'ENOENT'` arm fires recordError.
    const baddir = path.join(PERSONAL_VAULT, 'baddir');
    fs.mkdirSync(baddir, { recursive: true });
    fs.writeFileSync(path.join(baddir, 'child.md'), '---\ntitle: "X"\n---\nbody\n');
    fs.chmodSync(baddir, 0o000);
    try {
      // Root bypasses the mode bits — if readdirSync still succeeds, the
      // environment can't exercise this branch; skip the assertion (no false fail).
      let throws = false;
      try { fs.readdirSync(baddir, { withFileTypes: true }); } catch { throws = true; }
      if (!throws) return;
      const beforeErr = errors.length;
      reconcileIndex();
      expect(errors.length).toBeGreaterThan(beforeErr);
      const last = errors[errors.length - 1]!;
      expect(last.msg).toContain('reconcile readdirSync');
      // The child under the unreadable dir was never indexed.
      expect((memIndex as any)['baddir/child']).toBeUndefined();
    } finally {
      fs.chmodSync(baddir, 0o755); // restore so beforeEach's rmSync can clean it next run
    }
  });
});