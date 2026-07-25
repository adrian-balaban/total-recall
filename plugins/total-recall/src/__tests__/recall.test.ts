import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-recall-' + process.pid;
});

// 11.3b (3.6): mock the vector path so the hybrid branch ENTERS (embed returns a
// non-null query vector) but contributes nothing (searchVector returns []). This
// is the cold-store / dim-mismatch / deps-absent case the RRF-empty guard exists
// for. The mocks are file-wide; the existing tests all pass hybrid:false, so embed
// and searchVector are never called there — the mocks are inert for them.
vi.mock('../embeddings.js', () => ({
  embed: vi.fn(async () => Array(384).fill(0.1)),
}));
vi.mock('../vectorStore.js', () => ({
  searchVector: vi.fn(async () => []),
}));

import { recallMemory, searchIndex } from '../tools/recall.js';
import { memIndex } from '../state.js';
import { rebuildInvertedIndex } from '../tfidf.js';
import type { MemoryMetadata } from '../types.js';

const mkMeta = (overrides: Partial<MemoryMetadata> = {}): MemoryMetadata => ({
  key: 'k1',
  title: 't',
  tags: [],
  sessions: [],
  filePath: '/tmp/k1.md',
  created: '2025-01-01T00:00:00.000Z',
  updated: '2025-07-10T00:00:00.000Z',
  importanceScore: 0.5,
  category: 'knowledge',
  contentPreview: 'recall test body',
  accessCount: 0,
  lastAccessed: '2025-01-01T00:00:00.000Z',
  tokenEstimate: 4,
  isOrg: false,
  mtimeMs: 0,
  size: 0,
  ...overrides,
});

function resetIndex() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
}

describe('recall_memory boundary hardening', () => {
  beforeEach(() => {
    resetIndex();
    memIndex['knowledge/alpha'] = mkMeta({
      key: 'knowledge/alpha',
      title: 'Alpha memory',
      contentPreview: 'alpha body',
      tags: ['alpha'],
    });
    memIndex['knowledge/beta'] = mkMeta({
      key: 'knowledge/beta',
      title: 'Beta memory',
      contentPreview: 'beta body',
      tags: ['beta'],
    });
    rebuildInvertedIndex();
  });

  afterEach(resetIndex);

  it('coerces a non-string query to string instead of throwing', async () => {
    // Pre-fix: tokenize() called text.toLowerCase() on a number/null and threw.
    // Post-fix: String(args.query ?? '') produces a valid string.
    const res = await recallMemory({ query: 12345, hybrid: false });
    expect(Array.isArray(res)).toBe(true);
  });

  it('search_index coerces a non-string query to string', () => {
    // search_index is the metadata-only variant of recall_memory; it must not
    // crash when the MCP layer passes an unexpected non-string value.
    expect(() => searchIndex({ query: 12345 })).not.toThrow();
    expect(searchIndex({ query: 12345 })).toEqual([]);
    expect(() => searchIndex({ query: null })).not.toThrow();
  });

  it('clamps a malformed minScore to 0 (no filtering)', async () => {
    // NaN minScore pre-fix would make `r.score >= minScore` false for every
    // result, returning empty. Post-fix clamps to 0 so all matches survive.
    const baseline = await recallMemory({ query: 'alpha', hybrid: false });
    expect(baseline.length).toBeGreaterThan(0);

    const nan = await recallMemory({ query: 'alpha', minScore: NaN, hybrid: false });
    expect(nan.length).toBe(baseline.length);

    const negative = await recallMemory({ query: 'alpha', minScore: -10, hybrid: false });
    expect(negative.length).toBe(baseline.length);
  });

  it('honours a positive minScore floor once clamped', async () => {
    // A huge positive minScore should legitimately filter everything out.
    const strict = await recallMemory({ query: 'alpha', minScore: 1e9, hybrid: false });
    expect(strict.length).toBe(0);
  });
});

describe('recall_memory hybrid — RRF empty-vector guard (3.6)', () => {
  beforeEach(() => {
    resetIndex();
    memIndex['knowledge/alpha'] = mkMeta({
      key: 'knowledge/alpha',
      title: 'Alpha memory',
      contentPreview: 'alpha body',
      tags: ['alpha'],
    });
    rebuildInvertedIndex();
  });

  afterEach(resetIndex);

  it('keeps the TF-IDF score scale when the vector path returns empty (no RRF rescaling)', async () => {
    // 3.6: when searchVector returns [] (cold store / dim mismatch / deps absent),
    // the guard short-circuits to raw tfidfResults instead of fusing. Pre-fix, RRF
    // would rescale every TF-IDF hit to ~1/(60+rank) ≈ 0.0167 — orders of magnitude
    // below the raw TF-IDF score — so a minScore tuned for TF-IDF would drop
    // everything. Post-fix, the hybrid score stays on the TF-IDF scale.
    const tfidf = await recallMemory({ query: 'alpha', hybrid: false });
    const hybridEmpty = await recallMemory({ query: 'alpha', hybrid: true });
    expect(tfidf.length).toBeGreaterThan(0);
    expect(hybridEmpty.length).toBe(tfidf.length);
    // Same top result (RRF with empty vecResults keeps TF-IDF order).
    expect(hybridEmpty[0]!.key).toBe(tfidf[0]!.key);
    // Score stays on the TF-IDF scale: the access bump between the two calls shifts
    // the score by ~1.2×, but RRF rescaling would shrink it ~30×. A (0.3, 3) band
    // admits the access bump and kills the RRF-rescale mutant.
    const ratio = hybridEmpty[0]!.score / tfidf[0]!.score;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(3);
  });
});
