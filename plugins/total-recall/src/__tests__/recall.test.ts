import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-recall-' + process.pid;
});

import { recallMemory } from '../tools/recall.js';
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
