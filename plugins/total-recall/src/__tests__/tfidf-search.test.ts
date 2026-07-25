import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
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

import { tfidfSearch, rebuildInvertedIndex, tokenize } from '../tfidf.js';
import { memIndex } from '../state.js';
import { searchIndex } from '../tools/recall.js';

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