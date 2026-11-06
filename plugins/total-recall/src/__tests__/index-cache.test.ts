import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// The SessionStart index cache: pure rendering, the shared vault walk, the cache builder,
// parity with reconcileIndex ([TR-S13], [TR-S14], [TR-W8]) and the failure behaviour of
// the bundle. paths.ts freezes the vault paths at import, so HOME is redirected first.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-index-cache-' + process.pid;
});

vi.mock('../vectorStore.js', () => ({
  // reconcileVectors' model-switch check ([TR-R6]): null = no fingerprint, so nothing is dropped.
  getVecMeta: async () => null,
  dropVectorTable: async () => {},
  listVectorKeys: async () => null,
  deleteVector: async () => {},
}));
vi.mock('../embeddings.js', () => ({
  embedAndUpsert: async () => {},
}));

import { renderIndexCache, readCacheEntries, buildIndexCache } from '../index-cache.js';
import { renderIndexCache as renderFromMemory } from '../persistence.js';
import { listVaultFiles, keyUnder, categoryUnder } from '../vault-walk.js';
import { reconcileIndex } from '../vault-scan.js';
import { atomicWrite } from '../atomic-write.js';
import { PERSONAL_VAULT, ORG_VAULT, INDEX_CACHE_PATH } from '../paths.js';
import { memIndex } from '../state.js';

const CAN_SYMLINK = (() => {
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-sym-ic-'));
    fs.symlinkSync('nonexistent-target', path.join(d, 'link'));
    fs.rmSync(d, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

const dirs: string[] = [];
function tmp(prefix = 'tr-ic-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function put(base: string, rel: string, body: string): string {
  const fp = path.join(base, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, body);
  return fp;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(process.env.HOME as string, { recursive: true, force: true });
});

describe('renderIndexCache (pure)', () => {
  it('writes a count line, then one line per entry with title cut to 40 chars and 3 tags', () => {
    const out = renderIndexCache([
      { key: 'a/x', title: 'T'.repeat(50), tags: ['one', 'two', 'three', 'four'], category: 'a' },
      { key: 'b', title: 'Plain', tags: [], category: 'knowledge' },
    ]);
    expect(out.split('\n')).toEqual([
      '2',
      `- a/x: ${'T'.repeat(40)} [one, two, three, ...] (a)`,
      '- b: Plain [] (knowledge)',
    ]);
  });

  it('renders an empty vault as just "0"', () => {
    expect(renderIndexCache([])).toBe('0');
  });

  it('the server renders the same text from memIndex (hookless hosts)', () => {
    const before = { ...memIndex };
    for (const k of Object.keys(memIndex)) delete (memIndex as Record<string, unknown>)[k];
    (memIndex as Record<string, unknown>)['k/one'] = {
      key: 'k/one', title: 'One', tags: ['t'], category: 'k',
    };
    try {
      expect(renderFromMemory()).toBe('1\n- k/one: One [t] (k)');
    } finally {
      for (const k of Object.keys(memIndex)) delete (memIndex as Record<string, unknown>)[k];
      Object.assign(memIndex, before);
    }
  });
});

describe('vault-walk', () => {
  it('derives keys and categories relative to a base', () => {
    const base = '/v';
    expect(keyUnder(base, '/v/knowledge/a.md', false)).toBe('knowledge/a');
    expect(keyUnder(base, '/v/knowledge/a.md', true)).toBe('org/knowledge/a');
    expect(categoryUnder(base, '/v/knowledge/a.md')).toBe('knowledge');
    expect(categoryUnder(base, '/v/root.md')).toBe('knowledge');
    expect(categoryUnder(base, '/v/decisions/sub/a.md')).toBe('decisions');
  });

  it('skips excluded dirs in any casing, and the personal org/ subtree only for the personal vault', () => {
    const v = tmp();
    put(v, 'knowledge/ok.md', 'x');
    put(v, 'Projects/hidden.md', 'x');
    put(v, '.Obsidian/hidden.md', 'x');
    put(v, '.superseded/knowledge/old.md', 'x');
    put(v, 'org/inside.md', 'x');
    put(v, 'notes.txt', 'x');
    const rel = (files: string[]) => files.map((f) => path.relative(v, f)).sort();
    expect(rel(listVaultFiles(v, false))).toEqual(['knowledge/ok.md']);
    expect(rel(listVaultFiles(v, true))).toEqual(['knowledge/ok.md', 'org/inside.md']);
  });

  const symTest = CAN_SYMLINK ? it : it.skip;
  symTest('skips symlinked files, dangling symlinks and symlinked directories', () => {
    const v = tmp();
    const outside = tmp('tr-ic-out-');
    put(outside, 'secret.md', '---\ntitle: Secret\n---\n');
    put(v, 'knowledge/real.md', 'x');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(v, 'knowledge', 'linked.md'));
    fs.symlinkSync(path.join(v, 'nowhere'), path.join(v, 'knowledge', 'dangling.md'));
    fs.symlinkSync(outside, path.join(v, 'linkdir'));
    expect(listVaultFiles(v, false).map((f) => path.relative(v, f))).toEqual(['knowledge/real.md']);
  });

  it('reports a non-ENOENT readdir failure to the sink and stays quiet for a missing dir', () => {
    const v = tmp();
    const errs: string[] = [];
    expect(listVaultFiles(path.join(v, 'missing'), false, (m) => errs.push(m))).toEqual([]);
    expect(errs).toEqual([]);
    const file = put(v, 'plain-file', 'x');
    listVaultFiles(file, false, (m) => errs.push(m)); // ENOTDIR
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('reconcile readdirSync');
  });
});

describe('readCacheEntries / buildIndexCache', () => {
  it('strips CRLF, reads block-style and inline tags, unquotes titles, falls back to the file name', () => {
    const v = tmp();
    put(v, 'knowledge/crlf.md', ['---', 'title: CRLF Title', 'tags:', '  - kafka', '  - cdc', '---', 'body', ''].join('\r\n'));
    put(v, 'knowledge/inline.md', '---\ntitle: "Quoted Title"\ntags: [a, b]\n---\nbody\n');
    put(v, 'knowledge/untitled.md', '---\ntags: [z]\n---\nbody\n');
    put(v, 'knowledge/no-frontmatter.md', 'just text\n');
    const got = readCacheEntries(v, false);
    expect(got).toEqual([
      { key: 'knowledge/crlf', title: 'CRLF Title', tags: ['kafka', 'cdc'], category: 'knowledge' },
      { key: 'knowledge/inline', title: 'Quoted Title', tags: ['a', 'b'], category: 'knowledge' },
      { key: 'knowledge/no-frontmatter', title: 'no-frontmatter', tags: [], category: 'knowledge' },
      { key: 'knowledge/untitled', title: 'untitled', tags: ['z'], category: 'knowledge' },
    ]);
    expect(renderIndexCache(got)).not.toContain('\r');
  });

  it('coerces a numeric title and a scalar tags value instead of crashing', () => {
    const v = tmp();
    put(v, 'knowledge/odd.md', '---\ntitle: 2026\ntags: foo\n---\nbody\n');
    const [e] = readCacheEntries(v, false);
    expect(e?.title).toBe('2026');
    expect(Array.isArray(e?.tags)).toBe(true);
  });

  it('never indexes a reserved key', () => {
    const v = tmp();
    put(v, 'knowledge/__proto__.md', '---\ntitle: P\n---\n');
    put(v, 'constructor/x.md', '---\ntitle: C\n---\n');
    put(v, 'knowledge/fine.md', '---\ntitle: F\n---\n');
    expect(readCacheEntries(v, false).map((e) => e.key)).toEqual(['knowledge/fine']);
  });

  it('prefixes org keys, ignores a personal org/ dir, and tolerates a missing org vault', () => {
    const personal = tmp();
    const org = tmp();
    put(personal, 'knowledge/mine.md', '---\ntitle: Mine\n---\n');
    put(personal, 'org/shadow.md', '---\ntitle: Shadow\n---\n');
    put(org, 'architecture/shared.md', '---\ntitle: Shared\n---\n');
    const cache = path.join(tmp(), 'cache.txt');
    const r = buildIndexCache(personal, org, cache);
    expect(r).toEqual({ count: 2, errors: [] });
    expect(fs.readFileSync(cache, 'utf8')).toBe(
      '2\n- knowledge/mine: Mine [] (knowledge)\n- org/architecture/shared: Shared [] (architecture)\n',
    );
    const cache2 = path.join(tmp(), 'cache.txt');
    expect(buildIndexCache(personal, path.join(org, 'absent'), cache2).count).toBe(1);
  });

  it('an unwritable cache path is reported in errors and the previous cache is untouched', () => {
    const personal = tmp();
    put(personal, 'knowledge/a.md', '---\ntitle: A\n---\n');
    const dir = tmp();
    const cache = path.join(dir, 'cache.txt');
    fs.writeFileSync(cache, 'previous\n');
    // A directory squatting on the rename target makes the write fail.
    const blocked = path.join(dir, 'blocked');
    fs.mkdirSync(path.join(blocked, 'inner'), { recursive: true });
    const r = buildIndexCache(personal, path.join(personal, 'absent'), blocked);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(fs.readFileSync(cache, 'utf8')).toBe('previous\n');
  });
});

describe('parity: the cache lists exactly the keys reconcileIndex indexes', () => {
  beforeEach(() => {
    for (const k of Object.keys(memIndex)) delete (memIndex as Record<string, unknown>)[k];
  });

  it('agrees on a vault with every skip rule in play', () => {
    put(PERSONAL_VAULT, 'knowledge/a.md', '---\ntitle: A\ntags: [x]\n---\nbody\n');
    put(PERSONAL_VAULT, 'decisions/b.md', '---\ntitle: B\n---\nbody\n');
    put(PERSONAL_VAULT, 'root-level.md', '---\ntitle: Root\n---\nbody\n');
    put(PERSONAL_VAULT, 'Projects/skip.md', '---\ntitle: S\n---\n');
    put(PERSONAL_VAULT, 'org/skip.md', '---\ntitle: S\n---\n');
    put(PERSONAL_VAULT, 'knowledge/__proto__.md', '---\ntitle: P\n---\n');
    put(ORG_VAULT, 'architecture/c.md', '---\ntitle: C\n---\nbody\n');
    put(ORG_VAULT, '.obsidian/skip.md', '---\ntitle: S\n---\n');
    if (CAN_SYMLINK) {
      const outside = tmp('tr-ic-out-');
      put(outside, 'x.md', '---\ntitle: X\n---\n');
      fs.symlinkSync(path.join(outside, 'x.md'), path.join(PERSONAL_VAULT, 'knowledge', 'linked.md'));
    }

    reconcileIndex();
    const cache = path.join(tmp(), 'cache.txt');
    buildIndexCache(PERSONAL_VAULT, ORG_VAULT, cache);
    const lines = fs.readFileSync(cache, 'utf8').trim().split('\n');
    const cacheKeys = lines.slice(1).map((l) => l.slice(2, l.indexOf(': '))).sort();
    expect(cacheKeys).toEqual(Object.keys(memIndex).sort());
    expect(cacheKeys).toEqual(['decisions/b', 'knowledge/a', 'org/architecture/c', 'root-level']);
    expect(Number(lines[0])).toBe(cacheKeys.length);
  });
});

describe('atomic-write (leaf)', () => {
  it('writes through a tmp file and leaves no tmp behind', () => {
    const d = tmp();
    const target = path.join(d, 'sub', 'f.txt');
    atomicWrite(target, 'hello');
    expect(fs.readFileSync(target, 'utf8')).toBe('hello');
    expect(fs.readdirSync(path.join(d, 'sub'))).toEqual(['f.txt']);
  });

  it('reports a failed tmp write to the sink and leaves the target alone', () => {
    const d = tmp();
    const target = path.join(d, 'f.txt');
    fs.writeFileSync(target, 'last-good');
    fs.chmodSync(d, 0o500);
    const errs: string[] = [];
    try {
      atomicWrite(target, 'new', (m) => errs.push(m));
    } finally {
      fs.chmodSync(d, 0o700);
    }
    if (process.getuid && process.getuid() === 0) return; // root ignores the mode bits
    expect(errs[0]).toContain('tmp-write failed (last-good left intact)');
    expect(fs.readFileSync(target, 'utf8')).toBe('last-good');
  });

  it('falls back to a direct write when the rename fails, and reports when that fails too', () => {
    const d = tmp();
    const target = path.join(d, 'is-a-dir');
    fs.mkdirSync(path.join(target, 'inner'), { recursive: true });
    const errs: string[] = [];
    atomicWrite(target, 'data', (m) => errs.push(m));
    expect(errs[0]).toContain('rename-fallback');
    expect(fs.readdirSync(d)).toEqual(['is-a-dir']);
  });
});

// The bundle itself: exit codes, the failure log, and the previous cache surviving a failure.
const BUNDLE = path.resolve(__dirname, '..', '..', 'dist', 'build-index-cache.mjs');
const bundleSuite = fs.existsSync(BUNDLE) ? describe : describe.skip;

bundleSuite('dist/build-index-cache.mjs', () => {
  function run(home: string) {
    return spawnSync(process.execPath, [BUNDLE], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  }

  it('exits 0 and writes the cache', () => {
    const home = tmp('tr-ic-home-');
    put(home, '.total-recall/personal-vault/knowledge/a.md', '---\ntitle: A\n---\n');
    const r = run(home);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(home, '.total-recall', '.index-cache.txt'), 'utf8')).toBe(
      '1\n- knowledge/a: A [] (knowledge)\n',
    );
    expect(fs.existsSync(path.join(home, '.total-recall', '.index-cache.log'))).toBe(false);
  });

  it('on failure exits 1, keeps the previous cache and logs one timestamped line', () => {
    const home = tmp('tr-ic-home-');
    put(home, '.total-recall/personal-vault/knowledge/a.md', '---\ntitle: A\n---\n');
    const cache = path.join(home, '.total-recall', '.index-cache.txt');
    fs.writeFileSync(cache, 'previous\n');
    fs.rmSync(cache);
    fs.mkdirSync(path.join(cache, 'inner'), { recursive: true }); // cache path is now a non-empty dir
    const r = run(home);
    expect(r.status).toBe(1);
    const log = fs.readFileSync(path.join(home, '.total-recall', '.index-cache.log'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z v\S+ index-cache error atomicWrite\(/);
  });

  it('keeps only the last 1,000 log lines', () => {
    const home = tmp('tr-ic-home-');
    const base = path.join(home, '.total-recall');
    put(base, 'personal-vault/knowledge/a.md', '---\ntitle: A\n---\n');
    fs.mkdirSync(path.join(base, '.index-cache.txt', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(base, '.index-cache.log'), Array.from({ length: 1200 }, (_, i) => `old ${i}`).join('\n') + '\n');
    run(home);
    const log = fs.readFileSync(path.join(base, '.index-cache.log'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(1000);
    expect(log[0]).toBe('old 201');
    expect(log[999]).toContain('index-cache error');
  });
});

describe('default error sinks', () => {
  it('atomicWrite, listVaultFiles and readCacheEntries run without a sink and swallow errors', () => {
    const d = tmp();
    const blocked = path.join(d, 'is-a-dir');
    fs.mkdirSync(path.join(blocked, 'inner'), { recursive: true });
    expect(() => atomicWrite(blocked, 'x')).not.toThrow();
    const file = put(d, 'plain-file', 'x');
    expect(listVaultFiles(file, false)).toEqual([]);
    expect(readCacheEntries(file, false)).toEqual([]);
    const v = tmp();
    put(v, 'knowledge/a.md', '---\ntitle: A\n---\n');
    fs.chmodSync(path.join(v, 'knowledge', 'a.md'), 0o000);
    try { expect(() => readCacheEntries(v, false)).not.toThrow(); } finally { fs.chmodSync(path.join(v, 'knowledge', 'a.md'), 0o600); }
  });
});

// The entry point run in-process (the spawn tests above cover the built bundle).
describe('hooks/build-index-cache entry (in-process)', () => {
  const logPath = path.join(path.dirname(INDEX_CACHE_PATH), '.index-cache.log');
  const saved = process.exitCode;

  it('writes the cache from the configured vaults and leaves exitCode alone', async () => {
    put(PERSONAL_VAULT, 'knowledge/entry.md', '---\ntitle: Entry\n---\n');
    vi.resetModules();
    process.exitCode = undefined;
    await import('../hooks/build-index-cache.js');
    expect(process.exitCode).toBeUndefined();
    expect(fs.readFileSync(INDEX_CACHE_PATH, 'utf8')).toContain('- knowledge/entry: Entry [] (knowledge)');
  });

  it('sets exitCode 1, keeps going and logs when the cache cannot be written', async () => {
    fs.rmSync(INDEX_CACHE_PATH, { force: true });
    fs.mkdirSync(path.join(INDEX_CACHE_PATH, 'inner'), { recursive: true });
    fs.rmSync(logPath, { force: true });
    vi.resetModules();
    process.exitCode = undefined;
    try {
      await import('../hooks/build-index-cache.js');
      expect(process.exitCode).toBe(1);
      expect(fs.readFileSync(logPath, 'utf8')).toMatch(/ index-cache error atomicWrite\(/);
    } finally {
      process.exitCode = saved;
      fs.rmSync(INDEX_CACHE_PATH, { recursive: true, force: true });
    }
  });

  it('also logs an exception thrown by the build itself', async () => {
    fs.rmSync(logPath, { force: true });
    vi.resetModules();
    vi.doMock('../index-cache.js', () => ({ buildIndexCache: () => { throw new Error('boom'); } }));
    process.exitCode = undefined;
    try {
      await import('../hooks/build-index-cache.js');
      expect(process.exitCode).toBe(1);
      expect(fs.readFileSync(logPath, 'utf8')).toContain('index-cache error boom');
    } finally {
      process.exitCode = saved;
      vi.doUnmock('../index-cache.js');
    }
  });
});

// [TR-W8]: one writer. Every other production file must leave the cache path alone.
describe('single writer', () => {
  it('[TR-W8] only the build-index-cache bundle entry writes INDEX_CACHE_PATH', () => {
    expect(INDEX_CACHE_PATH.endsWith('.index-cache.txt')).toBe(true);
    const root = path.resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!e.name.endsWith('.ts')) continue;
        const rel = path.relative(root, p).split(path.sep).join('/');
        if (rel === 'paths.ts' || rel === 'index-cache.ts' || rel === 'hooks/build-index-cache.ts') continue;
        if (fs.readFileSync(p, 'utf8').includes('INDEX_CACHE_PATH')) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});


// Progressive context disclosure (Technology Radar Vol 35, Adopt): the injected index is capped
// so its cost stops growing with the vault. The memories left out stay findable by search.
describe('renderIndexCache: size cap (indexMaxEntries)', () => {
  const mk = (n: number, extra: Partial<import('../index-cache.js').CacheEntry> = {}) => ({
    key: `knowledge/m${String(n).padStart(3, '0')}`, title: `Memory ${n}`, tags: [], category: 'knowledge', ...extra,
  });

  it('lists everything when the vault is under the cap (output unchanged)', () => {
    const out = renderIndexCache([mk(1), mk(2)], 5);
    expect(out.split('\n')).toEqual(['2', '- knowledge/m001: Memory 1 [] (knowledge)', '- knowledge/m002: Memory 2 [] (knowledge)']);
  });

  it('keeps the highest-importance, then most recent, entries and says how many were left out', () => {
    const entries = [
      mk(1, { importance: 0.3, updated: '2026-11-05T00:00:00Z' }),
      mk(2, { importance: 1.0, updated: '2026-01-01T00:00:00Z' }),
      mk(3, { importance: 0.5, updated: '2026-02-01T00:00:00Z' }),
      mk(4, { importance: 0.5, updated: '2026-06-01T00:00:00Z' }),
    ];
    const lines = renderIndexCache(entries, 2).split('\n');
    expect(lines[0]).toBe('4');                                  // the count line stays the real total
    expect(lines.filter((l) => l.startsWith('- '))).toEqual([     // kept: importance 1.0 and the newer 0.5, in key order
      '- knowledge/m002: Memory 2 [] (knowledge)',
      '- knowledge/m004: Memory 4 [] (knowledge)',
    ]);
    expect(lines.at(-1)).toMatch(/2 more memories are not listed.*search_index/);
  });

  it('never drops a no-prune memory', () => {
    const entries = [
      mk(1, { importance: 0.1, tags: ['no-prune'] }),
      mk(2, { importance: 1.0 }), mk(3, { importance: 0.9 }),
    ];
    const kept = renderIndexCache(entries, 1).split('\n').filter((l) => l.startsWith('- '));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('knowledge/m001');
  });

  it('0 means no cap', () => {
    const many = Array.from({ length: 450 }, (_, i) => mk(i));
    expect(renderIndexCache(many, 0).split('\n').filter((l) => l.startsWith('- '))).toHaveLength(450);
  });

  it('the default cap is 300 and indexMaxEntries in config.json overrides it', () => {
    const many = Array.from({ length: 320 }, (_, i) => mk(i));
    expect(renderIndexCache(many).split('\n').filter((l) => l.startsWith('- '))).toHaveLength(300);
    fs.mkdirSync(path.join(process.env.HOME!, '.total-recall'), { recursive: true });
    fs.writeFileSync(path.join(process.env.HOME!, '.total-recall', 'config.json'), JSON.stringify({ indexMaxEntries: 10 }));
    try {
      expect(renderIndexCache(many).split('\n').filter((l) => l.startsWith('- '))).toHaveLength(10);
    } finally {
      fs.rmSync(path.join(process.env.HOME!, '.total-recall', 'config.json'), { force: true });
    }
  });

  it('reads importance and updated from the frontmatter when building from files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-cap-'));
    fs.mkdirSync(path.join(dir, 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'knowledge', 'a.md'), '---\ntitle: "A"\ntags: [no-prune]\nimportanceScore: 0.2\nupdated: 2026-05-01T00:00:00Z\n---\nbody\n');
    const [e] = readCacheEntries(dir, false);
    expect(e).toMatchObject({ key: 'knowledge/a', importance: 0.2, updated: '2026-05-01T00:00:00Z' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});


describe('renderIndexCache: ranking details', () => {
  const mk = (n: string, extra: Partial<import('../index-cache.js').CacheEntry> = {}) => ({
    key: `k/${n}`, title: n, tags: [], category: 'k', ...extra,
  });
  const keysOf = (out: string) => out.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2, l.indexOf(':')));

  it('lists the kept entries in key order even when their rank order is different', () => {
    const out = renderIndexCache([mk('a', { importance: 0.1 }), mk('b', { importance: 0.9 }), mk('c', { importance: 0.8 })], 2);
    expect(keysOf(out)).toEqual(['k/b', 'k/c']);
    const out2 = renderIndexCache([mk('z', { importance: 0.9 }), mk('y', { importance: 0.8 }), mk('x', { importance: 0.1 })], 2);
    expect(keysOf(out2)).toEqual(['k/y', 'k/z']);
  });

  it('ranks by importance first, then newest update, then key', () => {
    const entries = [
      mk('a', { importance: 0.5, updated: '2026-01-01' }),
      mk('b', { importance: 0.5, updated: '2026-03-01' }),
      mk('c', { importance: 0.5, updated: '2026-03-01' }),
      mk('d', { importance: 0.5 }),                      // no date counts as oldest
    ];
    expect(keysOf(renderIndexCache(entries, 1))).toEqual(['k/b']);   // newest, key b before c
    expect(keysOf(renderIndexCache(entries, 3))).toEqual(['k/a', 'k/b', 'k/c']);
  });

  it('treats a missing importance as 0.5', () => {
    const entries = [mk('a', { importance: 0.4 }), mk('b'), mk('c', { importance: 0.6 })];
    expect(keysOf(renderIndexCache(entries, 2))).toEqual(['k/b', 'k/c']);
  });

  it('a vault exactly at the cap is listed whole with no note', () => {
    const out = renderIndexCache([mk('a'), mk('b')], 2);
    expect(keysOf(out)).toEqual(['k/a', 'k/b']);
    expect(out).not.toContain('not listed');
  });

  it('leaves the given order alone when nothing is cut (under the cap, or exactly at it)', () => {
    expect(keysOf(renderIndexCache([mk('b'), mk('a')], 5))).toEqual(['k/b', 'k/a']);
    expect(keysOf(renderIndexCache([mk('b'), mk('a')], 2))).toEqual(['k/b', 'k/a']);
  });
});

describe('maxIndexEntries: reading the setting', () => {
  const cfgFile = () => path.join(process.env.HOME!, '.total-recall', 'config.json');
  const withConfig = async (c: object | null, fn: () => void) => {
    fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
    if (c === null) fs.rmSync(cfgFile(), { force: true }); else fs.writeFileSync(cfgFile(), JSON.stringify(c));
    // loadConfig caches by mtime: make sure a rewrite within the same millisecond is seen
    if (c !== null) fs.utimesSync(cfgFile(), new Date(), new Date(Date.now() + Math.random() * 1e6));
    try { fn(); } finally { fs.rmSync(cfgFile(), { force: true }); }
  };

  it.each([
    [{ indexMaxEntries: 7 }, 7],
    [{ indexMaxEntries: 0 }, 0],
    [{ indexMaxEntries: 7.9 }, 7],
    [{ indexMaxEntries: -1 }, 300],
    [{ indexMaxEntries: '5' }, 300],
    [{ indexMaxEntries: null }, 300],
    [{}, 300],
  ])('config %j gives %i', async (c, want) => {
    const { maxIndexEntries } = await import('../index-cache.js');
    await withConfig(c, () => expect(maxIndexEntries()).toBe(want));
  });

  it('is 300 without a config file', async () => {
    const { maxIndexEntries } = await import('../index-cache.js');
    await withConfig(null, () => expect(maxIndexEntries()).toBe(300));
  });

  it('ignores an importanceScore that is not a number when reading a vault', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-rank-'));
    fs.mkdirSync(path.join(dir, 'k'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'k', 'a.md'), '---\ntitle: "A"\nimportanceScore: high\n---\nx\n');
    fs.writeFileSync(path.join(dir, 'k', 'b.md'), '---\ntitle: "B"\nimportanceScore: 0.9\n---\nx\n');
    const entries = readCacheEntries(dir, false);
    expect(entries.find((e) => e.key === 'k/a')!.importance).toBeUndefined();
    expect(entries.find((e) => e.key === 'k/b')!.importance).toBe(0.9);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the entries of a vault sorted by key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-sort-'));
    for (const n of ['c', 'a', 'b']) {
      fs.mkdirSync(path.join(dir, 'k'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'k', `${n}.md`), `---\ntitle: "${n}"\n---\nx\n`);
    }
    expect(readCacheEntries(dir, false).map((e) => e.key)).toEqual(['k/a', 'k/b', 'k/c']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
