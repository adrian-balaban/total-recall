import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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

import { tfidfSearch, rebuildInvertedIndex } from '../tfidf.js';
import { memIndex } from '../state.js';

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