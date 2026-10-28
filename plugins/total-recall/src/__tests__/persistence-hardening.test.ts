import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Targets the persistence.ts mutants that survived the full Stryker run: the
// merge-from-disk guards, coerceMemEntry's per-field coercion, the timer error
// paths, the dirtyTokens bookkeeping and the index-cache line format. Each test
// asserts an observable outcome (a value in memIndex, a file on disk, an entry
// in the error sink), not an internal call.

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-persist-hard-' + process.pid;
});

vi.mock('../tfidf.js', async () => {
  const actual = await vi.importActual<typeof import('../tfidf.js')>('../tfidf.js');
  return { ...actual, rebuildInvertedIndex: vi.fn(actual.rebuildInvertedIndex) };
});

import {
  saveNow, loadIndexes, scheduleSave, scheduleAccessSave, scheduleIdfRecalc, flushPending,
  markIndexFresh, buildIndexCache, deriveFilePathFromKey,
} from '../persistence.js';
import { rebuildInvertedIndex } from '../tfidf.js';
import { memIndex, invertedIndex, errors } from '../state.js';
import { INDEX_PATH, INVERTED_INDEX_PATH, INDEX_CACHE_PATH, PERSONAL_VAULT, ORG_VAULT } from '../paths.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const mem = memIndex as Record<string, any>;
const inv = invertedIndex as Record<string, any>;

function clean() {
  for (const k of Object.keys(mem)) delete mem[k];
  for (const k of Object.keys(inv)) delete inv[k];
  errors.length = 0;
  for (const p of [INDEX_PATH, INVERTED_INDEX_PATH, INDEX_CACHE_PATH]) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
function seed(key: string, extra: Record<string, unknown> = {}) {
  mem[key] = {
    key, title: 'probe', tags: [], sessions: [], filePath: '/tmp/x.md', category: 'knowledge',
    contentPreview: '', accessCount: 0, lastAccessed: '', tokenEstimate: 1, isOrg: false,
    importanceScore: 0.5, created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}
function writeDisk(entries: unknown, wrapper: Record<string, unknown> = { v: 1 }) {
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify({ ...wrapper, entries }));
}

beforeEach(() => { clean(); vi.mocked(rebuildInvertedIndex).mockClear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); clean(); });

// ─── saveNow merge-from-disk: guards on malformed disk entries ───────────────

describe('saveNow merges runtime fields from disk — guards', () => {
  it('does not throw on a null or unknown-key disk entry, and leaves mem untouched', () => {
    seed('k/a', { accessCount: 2, lastAccessed: '2026-02-01T00:00:00.000Z' });
    writeDisk({ 'k/a': null, 'k/ghost': { accessCount: 9 }, 'k/arr': [1] });
    expect(() => saveNow()).not.toThrow();
    expect(mem['k/a'].accessCount).toBe(2);
    expect(mem['k/ghost']).toBeUndefined();
  });

  it('ignores a disk accessCount that is not a finite number', () => {
    seed('k/a', { accessCount: 2 });
    writeDisk({ 'k/a': { accessCount: '7' } });
    saveNow();
    expect(mem['k/a'].accessCount).toBe(2);
  });

  it('takes the disk accessCount when mem has none, and keeps the larger one otherwise', () => {
    seed('k/none', { accessCount: undefined });
    seed('k/big', { accessCount: 5 });
    writeDisk({ 'k/none': { accessCount: 4 }, 'k/big': { accessCount: 3 } });
    saveNow();
    expect(mem['k/none'].accessCount).toBe(4);
    expect(mem['k/big'].accessCount).toBe(5);
  });

  it('keeps a later in-memory lastAccessed over an older disk one, and adopts a later disk one', () => {
    seed('k/mine', { lastAccessed: '2026-05-01T00:00:00.000Z' });
    seed('k/theirs', { lastAccessed: '2026-01-01T00:00:00.000Z' });
    writeDisk({
      'k/mine': { lastAccessed: '2026-03-01T00:00:00.000Z' },
      'k/theirs': { lastAccessed: '2026-04-01T00:00:00.000Z' },
    });
    saveNow();
    expect(mem['k/mine'].lastAccessed).toBe('2026-05-01T00:00:00.000Z');
    expect(mem['k/theirs'].lastAccessed).toBe('2026-04-01T00:00:00.000Z');
  });

  it('ignores a disk lastAccessed that is not a string', () => {
    seed('k/a', { lastAccessed: '' });
    writeDisk({ 'k/a': { lastAccessed: 123 } });
    saveNow();
    expect(mem['k/a'].lastAccessed).toBe('');
  });

  it('ignores an index.json whose entries are not an object', () => {
    seed('k/a', { accessCount: 1 });
    for (const entries of [[{ accessCount: 9 }], 'x', null]) {
      writeDisk(entries);
      expect(() => saveNow()).not.toThrow();
      expect(mem['k/a'].accessCount).toBe(1);
    }
  });

  it('writes the merged index back wrapped with its version', () => {
    seed('k/a', { accessCount: 1 });
    saveNow();
    const disk = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    expect(disk.v).toBe(1);
    expect(disk.entries['k/a'].accessCount).toBe(1);
  });
});

// ─── loadIndexes / coerceMemEntry: untrusted index.json ──────────────────────

describe('loadIndexes coerces untrusted entries', () => {
  const base = { title: 't', tags: [], category: 'knowledge' };

  it('keeps valid fields as they are', () => {
    writeDisk({
      'decisions/ok': { ...base, category: 'decisions', accessCount: 5, lastAccessed: '2026-01-02T00:00:00.000Z', isOrg: false, mtimeMs: 12.5, size: 7 },
    });
    loadIndexes();
    const m = mem['decisions/ok'];
    expect(m).toMatchObject({ key: 'decisions/ok', category: 'decisions', accessCount: 5, lastAccessed: '2026-01-02T00:00:00.000Z', isOrg: false, mtimeMs: 12.5, size: 7 });
    expect(m.filePath).toBe(path.join(PERSONAL_VAULT, 'decisions/ok.md'));
  });

  it('replaces malformed fields with safe defaults', () => {
    writeDisk({
      'knowledge/weird': {
        title: 123, tags: [null, 5, 'a', ''], supersededAt: ['2026-01-01', 5, null],
        accessCount: -3, lastAccessed: 99, isOrg: 'yes', category: 7, mtimeMs: 'x', size: 'big',
      },
    });
    loadIndexes();
    const m = mem['knowledge/weird'];
    expect(m.title).toBe('123');
    expect(m.tags).toEqual(['5', 'a']);
    expect(m.supersededAt).toEqual(['2026-01-01']);
    expect(m.accessCount).toBe(0);
    expect(m.lastAccessed).toBe('');
    expect(m.isOrg).toBe(false);
    expect(m.category).toBe('knowledge');
    expect(m.mtimeMs).toBe(0);
    expect(m.size).toBe(0);
  });

  it('defaults a non-numeric accessCount to 0 and a missing supersededAt to undefined', () => {
    writeDisk({ 'knowledge/a': { ...base, accessCount: 'many' }, 'knowledge/b': { ...base } });
    loadIndexes();
    expect(mem['knowledge/a'].accessCount).toBe(0);
    expect(mem['knowledge/b'].supersededAt).toBeUndefined();
  });

  it('derives isOrg from the key prefix when the field is absent', () => {
    writeDisk({ 'org/knowledge/o': { ...base }, 'knowledge/p': { ...base } });
    loadIndexes();
    expect(mem['org/knowledge/o'].isOrg).toBe(true);
    expect(mem['org/knowledge/o'].filePath).toBe(path.join(ORG_VAULT, 'knowledge/o.md'));
    expect(mem['knowledge/p'].isOrg).toBe(false);
  });

  it('stays silent for an index.json that is not an object, and records a malformed wrapper', () => {
    for (const raw of ['[1,2]', '42', '"str"', 'null']) {
      fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
      fs.writeFileSync(INDEX_PATH, raw);
      loadIndexes();
      expect(errors).toEqual([]);
    }
    fs.writeFileSync(INDEX_PATH, JSON.stringify({ v: 999, entries: {} }));
    loadIndexes();
    expect(errors.some((e) => /schema version newer/.test(e.msg))).toBe(true);
  });
});

describe('deriveFilePathFromKey', () => {
  it('rejects unsafe or malformed keys', () => {
    for (const k of [5, '', null, '/abs', 'a//b', 'org/', 'org//x', 'a/../b', 'a/./b', 'a\\b', 'a\0b', '__proto__', 'x/constructor']) {
      expect(deriveFilePathFromKey(k as unknown)).toBeNull();
    }
  });
  it('maps a personal and an org key into their vault', () => {
    expect(deriveFilePathFromKey('knowledge/x')).toBe(path.join(PERSONAL_VAULT, 'knowledge/x.md'));
    expect(deriveFilePathFromKey('org/knowledge/x')).toBe(path.join(ORG_VAULT, 'knowledge/x.md'));
  });
});

// ─── atomicWrite fallbacks ───────────────────────────────────────────────────

describe('atomicWrite when the target cannot be replaced', () => {
  it('records the failure, never throws, and leaves no tmp file behind', () => {
    seed('k/a');
    fs.mkdirSync(INDEX_PATH, { recursive: true }); // a directory where index.json should be
    expect(() => saveNow()).not.toThrow();
    expect(errors.some((e) => e.msg.includes('rename-fallback'))).toBe(true);
    const leftovers = fs.readdirSync(path.dirname(INDEX_PATH)).filter((f) => f.startsWith('index.json.tmp.'));
    expect(leftovers).toEqual([]);
  });
});

// ─── debounced timers ────────────────────────────────────────────────────────

describe('debounced save timers', () => {
  beforeEach(() => { vi.useFakeTimers(); seed('k/a'); });

  it('scheduleSave writes index.json at +1s, then the inverted index and cache at +3s', () => {
    scheduleSave();
    vi.advanceTimersByTime(1000);
    expect(fs.existsSync(INDEX_PATH)).toBe(true);
    expect(fs.existsSync(INVERTED_INDEX_PATH)).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(fs.existsSync(INVERTED_INDEX_PATH)).toBe(true);
    expect(fs.existsSync(INDEX_CACHE_PATH)).toBe(true);
  });

  it('markIndexFresh cancels the follow-up inverted-index write', () => {
    scheduleSave();
    markIndexFresh();
    vi.advanceTimersByTime(10_000);
    expect(fs.existsSync(INDEX_PATH)).toBe(true);
    expect(fs.existsSync(INVERTED_INDEX_PATH)).toBe(false);
  });

  it('a serialisation failure in the save timer is recorded, not thrown', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mem['k/bad'] = { ...mem['k/a'], key: 'k/bad', title: 10n }; // JSON.stringify throws on BigInt
    scheduleSave();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(errors.some((e) => e.msg.startsWith('scheduleSave: '))).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });

  it('a serialisation failure in the IDF timer is recorded, not thrown', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    inv.bad = { docs: 10n } as any;
    scheduleIdfRecalc();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(errors.some((e) => e.msg.startsWith('scheduleIdfRecalc: '))).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });

  it('scheduleIdfRecalc called twice still writes once, 2s after the last call', () => {
    scheduleIdfRecalc();
    vi.advanceTimersByTime(1500);
    scheduleIdfRecalc();
    vi.advanceTimersByTime(1500);
    expect(fs.existsSync(INVERTED_INDEX_PATH)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(fs.existsSync(INVERTED_INDEX_PATH)).toBe(true);
  });
});

// ─── flushPending ────────────────────────────────────────────────────────────

describe('flushPending', () => {
  beforeEach(() => { vi.useFakeTimers(); seed('k/a'); });

  it('cancels both pending timers, so nothing is written again afterwards', () => {
    scheduleSave();
    scheduleIdfRecalc();
    flushPending();
    for (const p of [INDEX_PATH, INVERTED_INDEX_PATH, INDEX_CACHE_PATH]) fs.rmSync(p, { force: true });
    vi.advanceTimersByTime(10_000);
    expect(fs.existsSync(INDEX_PATH)).toBe(false);
    expect(fs.existsSync(INVERTED_INDEX_PATH)).toBe(false);
  });

  it('rebuilds the inverted index once for a token change, and not again for a later read-only flush', () => {
    scheduleSave();
    flushPending();
    expect(rebuildInvertedIndex).toHaveBeenCalledTimes(1);
    scheduleAccessSave();
    flushPending();
    expect(rebuildInvertedIndex).toHaveBeenCalledTimes(1);
  });

  it('records a saveNow failure and still returns', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mem['k/bad'] = { ...mem['k/a'], key: 'k/bad', title: 10n };
    scheduleAccessSave();
    expect(() => flushPending()).not.toThrow();
    expect(errors.some((e) => e.msg.startsWith('flushPending saveNow: '))).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });

  it('records a recalc failure after a successful save', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(rebuildInvertedIndex).mockImplementationOnce(() => { throw new Error('rebuild boom'); });
    scheduleSave();
    expect(() => flushPending()).not.toThrow();
    expect(fs.existsSync(INDEX_PATH)).toBe(true); // the save still landed
    expect(errors.some((e) => e.msg === 'flushPending recalcIdfNow: rebuild boom')).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── buildIndexCache line format ─────────────────────────────────────────────

describe('buildIndexCache', () => {
  it('writes a count line, then one line per memory with a 40-char title and at most 3 tags', () => {
    seed('k/long', { title: 'x'.repeat(50), tags: ['a', 'b', 'c', 'd'], category: 'decisions' });
    seed('k/three', { title: 'short', tags: ['a', 'b', 'c'] });
    seed('k/none', { title: 'bare', tags: [] });
    buildIndexCache();
    expect(fs.readFileSync(INDEX_CACHE_PATH, 'utf8').split('\n')).toEqual([
      '3',
      `- k/long: ${'x'.repeat(40)} [a, b, c, ...] (decisions)`,
      '- k/three: short [a, b, c] (knowledge)',
      '- k/none: bare [] (knowledge)',
    ]);
  });

  it('writes just "0" for an empty index', () => {
    buildIndexCache();
    expect(fs.readFileSync(INDEX_CACHE_PATH, 'utf8')).toBe('0');
  });
});
