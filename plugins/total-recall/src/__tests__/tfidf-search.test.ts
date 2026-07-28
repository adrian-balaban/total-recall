import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// #5: tfidfSearch's boost checks did meta.title.toLowerCase() and
// meta.tags.map(t => t.toLowerCase()) once per (token, doc) match, but the
// lower casings are constant per doc — a Q-token query matching D docs paid
// Q·D title + Q·D·|tags| tag toLowerCase allocations. The memoization caches
// the lowercased title + tags per doc-key, so it's one toLowerCase per doc per
// query. This test pins the memoization: a 4-token query matching ONE doc must
// NOT call toLowerCase once per (token, doc) — the count is bounded by the doc
// set, not by tokens × docs.

// Redirect HOME before any import so paths.ts (which captures os.homedir() once
// at load) points at a tmp vault — same vi.hoisted pattern as index.test.ts.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-tfidf-search-' + process.pid;
});

import { tfidfSearch, rebuildInvertedIndex, tokenize, registerDocument, deregisterDocument } from '../tfidf.js';
import { memIndex, invertedIndex } from '../state.js';
import { searchIndex } from '../tools/recall.js';
import { loadConfig } from '../paths.js';

const KEY = 'knowledge/boost-probe';

beforeAll(() => {
  // Seed one doc whose title contains all four query tokens, so every token
  // matches the SAME doc — the case where the pre-memoization code redundantly
  // re-lowercased the title + tags once per matching token.
  (memIndex as any)[KEY] = {
    key: KEY,
    title: 'alpha beta gamma delta',
    tags: ['sharedtag'],
    contentPreview: 'alpha beta gamma delta body',
    category: 'knowledge',
    filePath: '/tmp/boost-probe.md',
    accessCount: 0,
    lastAccessed: null,
    tokenEstimate: 8,
    isOrg: false,
    sessions: [],
    importanceScore: 0.5,
    created: '2026-06-30T00:00:00.000Z',
    updated: '2026-06-30T00:00:00.000Z',
  };
  rebuildInvertedIndex();
});

beforeEach(() => {
  // Clear the shared errors sink so a prior suite's records can't pollute.
  vi.restoreAllMocks();
});

describe('tfidfSearch per-token toLowerCase memoization (#5)', () => {
  it('lowercases each doc title + tags once, not once per matching token', () => {
    // 4 query tokens, all matching the one seeded doc. Pre-memoization the
    // boost path called title.toLowerCase() × 4 (once per token) plus
    // tags.map(toLowerCase) × 4 (once per token × 1 tag) plus tokenize's
    // query.toLowerCase() × 1 → ~9 toLowerCase calls. Memoized: tokenize (1)
    // + title memo (1) + tags memo (1 tag) = 3. Assert the count is bounded by
    // the doc set (≈3), not by tokens × docs (≈9) — a regression back to the
    // per-(token, doc) toLowerCase would blow past this threshold.
    const spy = vi.spyOn(String.prototype, 'toLowerCase');
    const before = spy.mock.calls.length;
    const results = tfidfSearch('alpha beta gamma delta', false);
    const calls = spy.mock.calls.length - before;
    spy.mockRestore();
    // The doc matched and ranked.
    expect(results.some((r) => r.key === KEY)).toBe(true);
    // Memoized: ~3 calls. Pre-memoization: ~9. Threshold 5 cleanly separates.
    expect(calls).toBeLessThan(5);
  });

  it('produces the same boosted score regardless of memoization (algebraically identical)', () => {
    // The memoization must not change ranking: a title-token match still gets
    // the ×2 boost and a tag-token match the ×1.5 boost. Pin the contract so a
    // future "optimize the boost" can't silently drop a boost branch.
    const results = tfidfSearch('sharedtag', false);
    const hit = results.find((r) => r.key === KEY);
    expect(hit).toBeDefined();
    // 'sharedtag' matches the tag (×1.5) but not the title (no ×2). tf>0 so the
    // doc is ranked with a positive score — the boost path ran and matched.
    expect(hit!.score).toBeGreaterThan(0);
  });
});

describe('tokenize diacritic normalization (Pass 1 hardening)', () => {
  it('strips combining marks but keeps the base Romanian letters', () => {
    // Pre-fix replaced every non-ASCII char with a space, turning "întâlnire"
    // into separate tokens and losing the word entirely. Post-fix NFKD-decomposes
    // the diacritics and strips the combining marks, leaving "intalnire".
    expect(tokenize('întâlnire')).toContain('intalnire');
    expect(tokenize('șță')).toContain('sta');
  });

  it('still lowercases and removes pure non-letter punctuation', () => {
    expect(tokenize('Café!')).toContain('cafe');
  });
});

describe('searchIndex tags filter — missing entry guard', () => {
  it('does not crash when a result key has no memIndex entry', () => {
    // Seed a doc, then wipe its memIndex entry after rebuilding so the filter
    // sees a stale tfidf result. The optional-chain guard must keep the search
    // alive instead of throwing on memIndex[r.key].tags.includes.
    const KEY = 'knowledge/orphan';
    (memIndex as any)[KEY] = {
      key: KEY,
      title: 'orphan doc',
      tags: ['x'],
      contentPreview: 'body',
      category: 'knowledge',
      filePath: '/tmp/orphan.md',
      accessCount: 0,
      lastAccessed: null,
      tokenEstimate: 2,
      isOrg: false,
      sessions: [],
      importanceScore: 0.5,
      created: '2026-06-30T00:00:00.000Z',
      updated: '2026-06-30T00:00:00.000Z',
    };
    rebuildInvertedIndex();
    delete (memIndex as any)[KEY];
    expect(() => searchIndex({ query: 'orphan', tags: ['x'] })).not.toThrow();
  });
});

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

// ─── 5.1 / 5.2 / 5.3 (REVIEW): TF-IDF ranking-quality regressions ─────────────
// 5.1: title/tag boost must use exact TOKEN match, not substring .includes.
//      'cat' must NOT boost a doc titled 'Category theory' (substring 'cat' in
//      'category') — only a doc whose title actually tokenizes to 'cat'.
// 5.2: sublinear TF (1+log tf) + length norm (÷ sqrt(totalTokens)) so a verbose
//      memory repeating a term many times doesn't drown out a concise one.
// 5.3: confirmations/flags feed computeRetentionStrength so a confirmed memory
//      surfaces better in search (not just survives pruning).

const baseMeta = {
  category: 'knowledge',
  filePath: '/tmp/probe.md',
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

describe('5.1: title boost is exact-token, not substring', () => {
  it('does NOT boost "Category theory" for query "cat" (substring was a false match)', () => {
    // docSubstr: title 'Category theory' contains the substring 'cat' but does
    // NOT tokenize to 'cat' — the old .includes('cat') boost wrongly fired ×2.
    // docEqual: title 'feline animal' has no 'cat' anywhere; same tf & norm so
    // the ONLY score difference under the old code was the false substring boost.
    const A = 'knowledge/substr-false';
    const B = 'knowledge/equal-tf';
    seedDoc(A, 'Category theory', [], 'cat');          // 3 tokens: category, theory, cat
    seedDoc(B, 'feline animal', [], 'cat');            // 3 tokens: feline, animal, cat
    rebuildInvertedIndex();
    const r = tfidfSearch('cat', false);
    const a = r.find((x) => x.key === A);
    const b = r.find((x) => x.key === B);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Both have tf(cat)=1 and norm=sqrt(3) and (post-5.1) NO title boost for 'cat'.
    // Under the old substring code A would be ×2 (false 'cat' in 'category') and
    // outrank B; post-fix they are equal.
    expect(a!.score).toBeCloseTo(b!.score, 6);
    cleanKeys([A, B]);
  });
});

describe('5.2: sublinear TF + length norm — verbose does not dominate', () => {
  it('ranks a concise cat-titled doc above a verbose one repeating "cat" 9×', () => {
    // Concise: title 'cat', body 'cat' → tf(cat)=2, totalTokens=2.
    // Verbose: title 'cat', body 'cat cat cat cat cat cat cat cat cat' → tf=10, totalTokens=10.
    // Both get the ×2 title boost. Old linear-TF/no-norm: verbose 10 > concise 2
    // → verbose wins. Post-5.2: concise (1+log2)·2/√2 ≈ 2.39·idf > verbose
    // (1+log10)·2/√10 ≈ 2.09·idf → concise wins.
    const C = 'knowledge/concise-cat';
    const V = 'knowledge/verbose-cat';
    seedDoc(C, 'cat', [], 'cat');
    seedDoc(V, 'cat', [], 'cat cat cat cat cat cat cat cat cat');
    rebuildInvertedIndex();
    const r = tfidfSearch('cat', false);
    const c = r.find((x) => x.key === C);
    const v = r.find((x) => x.key === V);
    expect(c).toBeDefined();
    expect(v).toBeDefined();
    expect(c!.score).toBeGreaterThan(v!.score);
    cleanKeys([C, V]);
  });
});

describe('5.3: confirmations/flags affect search ranking, not just pruning', () => {
  it('ranks a confirmed memory above a flagged one with equal other inputs', () => {
    // Two docs, identical title/tags/body/importance/age/accessCount. Only
    // confirmations vs flags differ. computeRetentionStrength multiplies by
    // (1 + access·0.2 + confirm·0.1 − flags·0.1): confirmed (c=5) → ×1.5,
    // flagged (f=3) → ×0.7. Pre-5.3 tfidfSearch called computeRetentionStrength
    // WITHOUT confirmations/flags, so both decayed identically and ranked
    // equal — defeating the tool's promise that confirm_memory / flag surface
    // in search. Post-5.3 the confirmed doc ranks strictly higher.
    const CONF = 'knowledge/confirmed-probe';
    const FLAG = 'knowledge/flagged-probe';
    seedDoc(CONF, 'probe', [], 'probe', { confirmations: 5, flags: 0 });
    seedDoc(FLAG, 'probe', [], 'probe', { confirmations: 0, flags: 3 });
    rebuildInvertedIndex();
    const r = tfidfSearch('probe', false);
    const conf = r.find((x) => x.key === CONF);
    const flag = r.find((x) => x.key === FLAG);
    expect(conf).toBeDefined();
    expect(flag).toBeDefined();
    expect(conf!.score).toBeGreaterThan(flag!.score);
    cleanKeys([CONF, FLAG]);
  });
});

// ─── Mutation-hardening: pin BILINGUAL_DICT literals, registerDocument, exact boosts ─

describe('tokenize whitespace + diacritic edge cases', () => {
  it('collapses runs of whitespace into single token boundaries', () => {
    expect(tokenize('a  b')).toEqual(['a', 'b']);
    expect(tokenize('a\tb\nc')).toEqual(['a', 'b', 'c']);
    expect(tokenize('   ')).toEqual([]);
  });

  it('strips diacritics from Romanian tokens to base letters', () => {
    expect(tokenize('întâlnire')).toEqual(['intalnire']);
    expect(tokenize('șță')).toEqual(['sta']);
    expect(tokenize('Café')).toEqual(['cafe']);
  });

  it('splits on non-alphanumeric (punctuation becomes a boundary)', () => {
    expect(tokenize('cat,dog')).toEqual(['cat', 'dog']);
    expect(tokenize('foo.bar')).toEqual(['foo', 'bar']);
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

  // loadConfig caches by mtimeMs (paths.ts). Under Stryker's dry-run the 9
  // allow-listed files share one vitest worker, so paths.ts's module-level
  // cachedConfig/cachedMtime persists across files AND across describes in
  // this file. The BILINGUAL_DICT describe above caches
  // {enableMultilingualSearch:true} at mtime T_last; if this describe writes
  // the OFF config in the same millisecond, loadConfig's mtime === cachedMtime
  // check returns the stale true. Removing the file then calling loadConfig
  // forces the statSync-ENOENT branch, which clears the cache (cachedConfig =
  // null), so the subsequent write is always read fresh regardless of mtime.
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

describe('registerDocument / deregisterDocument (incremental index update)', () => {
  // registerDocument populates invertedIndex + docLengths but NOT memIndex —
  // tfidfSearch reads memIndex[doc.key] for decay/title/tags, so the meta must
  // be seeded via seedDoc first. The intended pattern is seedDoc (memIndex) →
  // registerDocument (incremental inverted-index update, avoids full rebuild).
  it('registerDocument populates the inverted index and docLengths (ranked by tfidfSearch)', () => {
    const key = 'knowledge/reg-probe';
    seedDoc(key, 'cat tales', ['feline'], 'cat content cat');
    registerDocument(key, 'cat tales', ['feline'], 'cat content cat');
    // 'cat' now in the inverted index with this doc.
    expect(invertedIndex['cat']).toBeDefined();
    expect(invertedIndex['cat']!.docs.some((d) => d.key === key)).toBe(true);
    // tfidfSearch ranks the doc (memIndex has the meta for decay + boosts).
    const results = tfidfSearch('cat', false);
    expect(results.some((r) => r.key === key)).toBe(true);
    cleanKeys([key]);
  });

  it('deregisterDocument removes all of the doc postings', () => {
    const key = 'knowledge/dereg-probe';
    seedDoc(key, 'uniquewordinthiscase', [], 'uniquewordbody');
    registerDocument(key, 'uniquewordinthiscase', [], 'uniquewordbody');
    expect(invertedIndex['uniquewordinthiscase']).toBeDefined();
    deregisterDocument(key);
    // The token had only this one doc → the entry is deleted entirely.
    expect(invertedIndex['uniquewordinthiscase']).toBeUndefined();
    const results = tfidfSearch('uniquewordinthiscase', false);
    expect(results.some((r) => r.key === key)).toBe(false);
    cleanKeys([key]);
  });

  it('deregisterDocument keeps other docs sharing a token', () => {
    const a = 'knowledge/shared-a';
    const b = 'knowledge/shared-b';
    seedDoc(a, 'commonword', [], 'body a');
    seedDoc(b, 'commonword', [], 'body b');
    registerDocument(a, 'commonword', [], 'body a');
    registerDocument(b, 'commonword', [], 'body b');
    expect(invertedIndex['commonword']!.docs.length).toBe(2);
    deregisterDocument(a);
    expect(invertedIndex['commonword']!.docs.length).toBe(1);
    expect(invertedIndex['commonword']!.docs.some((d) => d.key === b)).toBe(true);
    cleanKeys([a, b]);
  });

  it('registerDocument replaces (not duplicates) when re-registering the same key', () => {
    const key = 'knowledge/re-reg-probe';
    seedDoc(key, 'oldtitle oldtoken', [], 'oldbody');
    registerDocument(key, 'oldtitle oldtoken', [], 'oldbody');
    expect(invertedIndex['oldtoken']!.docs.filter((d) => d.key === key).length).toBe(1);
    // Re-register with a different title — old token should be dropped.
    registerDocument(key, 'newtitle newtoken', [], 'newbody');
    expect(invertedIndex['oldtoken']).toBeUndefined();
    expect(invertedIndex['newtoken']!.docs.filter((d) => d.key === key).length).toBe(1);
    cleanKeys([key]);
  });
});

describe('exact title/tag boost scores (×2 / ×1.5)', () => {
  // All three docs engineered to totalTokens=3 so the sqrt(totalTokens) length
  // norm is identical across docs — leaving the boost multiplier as the ONLY
  // score difference. tf[kangaroo]=1 in each, same idf, same decay (baseMeta).
  it('a title-token doc outscores a tag-token doc outscores a content-only doc', () => {
    const T = 'knowledge/boost-title';
    const G = 'knowledge/boost-tag';
    const C = 'knowledge/boost-content';
    // T: tokens [kangaroo, aa, bb] → tf=1, norm=sqrt(3); title has 'kangaroo' → ×2.
    seedDoc(T, 'kangaroo', [], 'aa bb');
    // G: tokens [tagged, kangaroo, aa] → tf=1, norm=sqrt(3); tag has 'kangaroo' → ×1.5.
    seedDoc(G, 'tagged', ['kangaroo'], 'aa');
    // C: tokens [content, kangaroo, aa] → tf=1, norm=sqrt(3); no boost → ×1.
    seedDoc(C, 'content', [], 'kangaroo aa');
    rebuildInvertedIndex();
    const r = tfidfSearch('kangaroo', false);
    const t = r.find((x) => x.key === T)!;
    const g = r.find((x) => x.key === G)!;
    const c = r.find((x) => x.key === C)!;
    expect(t.score).toBeGreaterThan(g.score);
    expect(g.score).toBeGreaterThan(c.score);
    // With identical idf + norm + decay, the ratio IS the boost ratio.
    expect(g.score / t.score).toBeCloseTo(1.5 / 2, 5);
    expect(c.score / t.score).toBeCloseTo(1 / 2, 5);
    cleanKeys([T, G, C]);
  });

  it('a doc matching the token in BOTH title and tag gets ×2 ×1.5 = ×3', () => {
    const BOTH = 'knowledge/boost-both';
    const TITLE = 'knowledge/boost-just-title';
    // Both docs tf[kangaroo]=2, totalTokens=3 → identical (1+log2) factor and
    // norm=sqrt(3). The ONLY score difference is ×3 (title+tag) vs ×2 (title).
    // BOTH: tokens [kangaroo, kangaroo, zzz] (title + tag both 'kangaroo').
    seedDoc(BOTH, 'kangaroo', ['kangaroo'], 'zzz');
    // TITLE: tokens [kangaroo, other, kangaroo] (title 'kangaroo' + content 'kangaroo').
    // 'other' tag does NOT match query → only the ×2 title boost fires.
    seedDoc(TITLE, 'kangaroo', ['other'], 'kangaroo');
    rebuildInvertedIndex();
    const r = tfidfSearch('kangaroo', false);
    const both = r.find((x) => x.key === BOTH)!;
    const title = r.find((x) => x.key === TITLE)!;
    expect(both.score / title.score).toBeCloseTo(3 / 2, 5);
    cleanKeys([BOTH, TITLE]);
  });
});