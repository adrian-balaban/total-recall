import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// RO/EN bilingual query expansion. This file is INTENTIONALLY excluded from
// Stryker's mutation allow-list (vitest.stryker.config.ts names only
// tfidf-search.test.ts). Reason: these tests toggle ~/.total-recall/config.json
// and rely on loadConfig() re-reading it, but paths.ts's CONFIG_PATH is a
// top-level const frozen to whichever test file imports paths.ts first in the
// shared Stryker worker — so under Stryker's instrumented dry-run loadConfig()
// reads a different HOME's config than this file writes, producing a cross-file
// state leak that aborts the dry-run. The bilingual feature is exercised here
// under the normal vitest run (which gives each file a fresh module graph);
// Stryker instead disables mutation on the BILINGUAL_DICT + expansion block
// (see tfidf.ts), so excluding this file costs no mutation coverage.

// Redirect HOME before any import so paths.ts (which captures os.homedir() once
// at load) points at a tmp vault — same vi.hoisted pattern as tfidf-search.test.ts.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-tfidf-multilingual-' + process.pid;
});

import { tfidfSearch, rebuildInvertedIndex } from '../tfidf.js';
import { memIndex } from '../state.js';
import { loadConfig } from '../paths.js';

const baseMeta = {
  category: 'knowledge',
  filePath: '/tmp/multilingual-probe.md',
  accessCount: 0,
  lastAccessed: null,
  tokenEstimate: 4,
  isOrg: false,
  sessions: [],
  importanceScore: 0.5,
  created: '2026-06-30T00:00:00.000Z',
  updated: '2026-06-30T00:00:00.000Z',
};

function seedDoc(key: string, title: string, tags: string[], contentPreview: string, extra: Partial<any> = {}) {
  (memIndex as any)[key] = { key, title, tags, contentPreview, ...baseMeta, ...extra };
}

function cleanKeys(keys: string[]) {
  for (const k of keys) delete (memIndex as any)[k];
  rebuildInvertedIndex();
}

describe('multilingual search expansion', () => {
  it('expands Romanian query terms via BILINGUAL_DICT when enabled', () => {
    const HOME = process.env.HOME!;
    const cfgDir = path.join(HOME, '.total-recall');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ enableMultilingualSearch: true }),
    );

    const KEY = 'knowledge/ro';
    (memIndex as any)[KEY] = {
      key: KEY,
      title: 'Architecture Decision',
      tags: ['adr'],
      contentPreview: 'Architecture decision body',
      category: 'knowledge',
      filePath: '/tmp/ro-probe.md',
      accessCount: 0,
      lastAccessed: null,
      tokenEstimate: 4,
      isOrg: false,
      sessions: [],
      importanceScore: 0.5,
      created: '2026-06-30T00:00:00.000Z',
      updated: '2026-06-30T00:00:00.000Z',
    };
    rebuildInvertedIndex();

    const results = tfidfSearch('arhitectura', false);
    expect(results.some((r) => r.key === KEY)).toBe(true);

    delete (memIndex as any)[KEY];
    rebuildInvertedIndex();
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });
});

describe('multilingual BILINGUAL_DICT — every entry direction is exercised', () => {
  // One test per dict direction kills the 28 string-literal mutants (a mutant
  // that blanks a dict value would silently drop that translation).
  const HOME = process.env.HOME!;

  beforeEach(() => {
    const cfgDir = path.join(HOME, '.total-recall');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ enableMultilingualSearch: true }),
    );
  });

  afterEach(() => {
    fs.rmSync(path.join(HOME, '.total-recall'), { recursive: true, force: true });
  });

  function roQueryFindsEnglishDoc(roQuery: string, enToken: string) {
    const key = `knowledge/ro-${enToken}-${Math.random().toString(36).slice(2, 8)}`;
    seedDoc(key, `title ${enToken}`, [], `body ${enToken}`);
    rebuildInvertedIndex();
    const results = tfidfSearch(roQuery, false);
    const hit = results.some((r) => r.key === key);
    cleanKeys([key]);
    return hit;
  }

  it('RO→EN: sedinta expands to meeting', () => {
    expect(roQueryFindsEnglishDoc('sedinta', 'meeting')).toBe(true);
  });
  it('RO→EN: decizie expands to decision', () => {
    expect(roQueryFindsEnglishDoc('decizie', 'decision')).toBe(true);
  });
  it('RO→EN: problema expands to troubleshooting', () => {
    expect(roQueryFindsEnglishDoc('problema', 'troubleshooting')).toBe(true);
  });
  it('RO→EN: jurnal expands to journal', () => {
    expect(roQueryFindsEnglishDoc('jurnal', 'journal')).toBe(true);
  });
  it('RO→EN: memorie expands to memory', () => {
    expect(roQueryFindsEnglishDoc('memorie', 'memory')).toBe(true);
  });
  it('RO→EN: salvare expands to store', () => {
    expect(roQueryFindsEnglishDoc('salvare', 'store')).toBe(true);
  });
  it('RO→EN: actualizare expands to update', () => {
    expect(roQueryFindsEnglishDoc('actualizare', 'update')).toBe(true);
  });
  it('RO→EN: stergere expands to delete', () => {
    expect(roQueryFindsEnglishDoc('stergere', 'delete')).toBe(true);
  });
  it('RO→EN: concepte expands to concepts', () => {
    expect(roQueryFindsEnglishDoc('concepte', 'concepts')).toBe(true);
  });
  it('RO→EN: intalnire expands to meeting', () => {
    expect(roQueryFindsEnglishDoc('intalnire', 'meeting')).toBe(true);
  });

  function enQueryFindsRomanianDoc(enQuery: string, roToken: string) {
    // The RO doc's title contains the RO form; querying the EN form must still
    // match via EN→RO expansion.
    const key = `knowledge/en-${roToken}-${Math.random().toString(36).slice(2, 8)}`;
    seedDoc(key, `${roToken} titlu`, [], `${roToken} continut`);
    rebuildInvertedIndex();
    const results = tfidfSearch(enQuery, false);
    const hit = results.some((r) => r.key === key);
    cleanKeys([key]);
    return hit;
  }

  it('EN→RO: decision expands to decizie', () => {
    expect(enQueryFindsRomanianDoc('decision', 'decizie')).toBe(true);
  });
  it('EN→RO: meeting expands to sedinta', () => {
    expect(enQueryFindsRomanianDoc('meeting', 'sedinta')).toBe(true);
  });
  it('EN→RO: architecture expands to arhitectura', () => {
    expect(enQueryFindsRomanianDoc('architecture', 'arhitectura')).toBe(true);
  });
  it('EN→RO: troubleshooting expands to problema', () => {
    expect(enQueryFindsRomanianDoc('troubleshooting', 'problema')).toBe(true);
  });
  it('EN→RO: journal expands to jurnal', () => {
    expect(enQueryFindsRomanianDoc('journal', 'jurnal')).toBe(true);
  });
  it('EN→RO: memories expands to memorii', () => {
    expect(enQueryFindsRomanianDoc('memories', 'memorii')).toBe(true);
  });
  it('EN→RO: concepts expands to concepte', () => {
    expect(enQueryFindsRomanianDoc('concepts', 'concepte')).toBe(true);
  });
});

describe('multilingual OFF vs ON produces different results for a RO query', () => {
  const HOME = process.env.HOME!;
  const cfgDir = path.join(HOME, '.total-recall');

  afterEach(() => {
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });

  // loadConfig caches by mtimeMs (paths.ts). The BILINGUAL_DICT describe above
  // caches {enableMultilingualSearch:true} at mtime T_last; if this describe
  // writes the OFF config in the same millisecond, loadConfig's mtime ===
  // cachedMtime check returns the stale true. Removing the file then calling
  // loadConfig forces the statSync-ENOENT branch, which clears the cache
  // (cachedConfig = null), so the subsequent write is always read fresh.
  function writeMultilingualConfig(value: boolean) {
    fs.rmSync(cfgDir, { recursive: true, force: true });
    loadConfig(); // file absent → statSync ENOENT → cache cleared
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ enableMultilingualSearch: value }),
    );
  }

  it('with multilingual OFF, a RO query does not match an EN-only doc', () => {
    writeMultilingualConfig(false);
    const key = 'knowledge/ro-off-probe';
    seedDoc(key, 'meeting notes', [], 'meeting body');
    rebuildInvertedIndex();
    const results = tfidfSearch('sedinta', false);
    expect(results.some((r) => r.key === key)).toBe(false);
    cleanKeys([key]);
  });

  it('with multilingual ON, the same RO query matches the EN doc', () => {
    writeMultilingualConfig(true);
    const key = 'knowledge/ro-on-probe';
    seedDoc(key, 'meeting notes', [], 'meeting body');
    rebuildInvertedIndex();
    const results = tfidfSearch('sedinta', false);
    expect(results.some((r) => r.key === key)).toBe(true);
    cleanKeys([key]);
  });
});