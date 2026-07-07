import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listMemories, getMemoriesByKeys, getTimeline, getRelatedMemories, pruneMemories } from '../tools/query.js';
import { memIndex } from '../state.js';
import { contentCache } from '../lru-cache.js';
import type { MemoryMetadata } from '../types.js';

const mkMeta = (overrides: Partial<MemoryMetadata> = {}): MemoryMetadata => ({
  key: 'k1',
  title: 't',
  tags: [],
  sessions: [],
  filePath: '/tmp/k1.md',
  created: '2025-01-01T00:00:00.000Z',
  updated: '2025-01-01T00:00:00.000Z',
  importanceScore: 0.5,
  category: 'knowledge',
  contentPreview: '',
  accessCount: 0,
  lastAccessed: '2025-01-01T00:00:00.000Z',
  tokenEstimate: 0,
  isOrg: false,
  mtimeMs: 0,
  size: 0,
  ...overrides,
});

function resetIndex() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
}

describe('query tools', () => {
  beforeEach(resetIndex);
  afterEach(() => {
    // Drop any contentCache entries this file inserted so later tests don't see
    // stale bodies for the same keys.
    for (const k of Object.keys(memIndex)) contentCache.delete(k);
    resetIndex();
  });

  describe('listMemories', () => {
    it('returns paginated metadata sorted by updated desc', () => {
      memIndex['a'] = mkMeta({ key: 'a', title: 'A', updated: '2025-02-01T00:00:00.000Z', tags: ['x'] });
      memIndex['b'] = mkMeta({ key: 'b', title: 'B', updated: '2025-03-01T00:00:00.000Z', tags: ['y'], category: 'journal' });
      memIndex['c'] = mkMeta({ key: 'c', title: 'C', updated: '2025-01-01T00:00:00.000Z' });

      const first = listMemories({ limit: 2, offset: 0 });
      expect(first.total).toBe(3);
      expect(first.items.map((i: any) => i.key)).toEqual(['b', 'a']);
      expect(first.hasMore).toBe(true);

      const second = listMemories({ limit: 2, offset: 2 });
      expect(second.items.map((i: any) => i.key)).toEqual(['c']);
      expect(second.hasMore).toBe(false);
    });

    it('filters by category and tag', () => {
      memIndex['a'] = mkMeta({ key: 'a', title: 'A', category: 'journal', tags: ['x'] });
      memIndex['b'] = mkMeta({ key: 'b', title: 'B', category: 'knowledge', tags: ['x'] });
      memIndex['c'] = mkMeta({ key: 'c', title: 'C', category: 'knowledge', tags: ['y'] });

      expect(listMemories({ category: 'journal' }).items.map((i: any) => i.key)).toEqual(['a']);
      // Same default `updated` timestamp; stable sort preserves memIndex insertion order.
      expect(listMemories({ tag: 'x' }).items.map((i: any) => i.key)).toEqual(['a', 'b']);
      expect(listMemories({ category: 'knowledge', tag: 'y' }).items.map((i: any) => i.key)).toEqual(['c']);
    });

    it('clamps huge/negative limit and offset to safe defaults', () => {
      for (let i = 0; i < 5; i++) {
        memIndex[`k${i}`] = mkMeta({
          key: `k${i}`,
          title: `T${i}`,
          updated: `2025-01-0${i + 1}T00:00:00.000Z`,
        });
      }
      const huge = listMemories({ limit: Number.MAX_SAFE_INTEGER, offset: Number.MAX_SAFE_INTEGER });
      expect(huge.items.length).toBeLessThanOrEqual(1000);
      expect(huge.total).toBe(5);
      expect(huge.hasMore).toBe(false);

      const nan = listMemories({ limit: NaN, offset: NaN });
      expect(nan.items.length).toBe(5);
      expect(nan.total).toBe(5);
      expect(nan.hasMore).toBe(false);

      const negativeOffset = listMemories({ offset: -5 });
      expect(negativeOffset.items.length).toBe(5);
      expect(negativeOffset.total).toBe(5);

      const negativeLimit = listMemories({ limit: -5 });
      expect(negativeLimit.items.length).toBe(1);
      expect(negativeLimit.total).toBe(5);
    });
  });

  describe('getMemoriesByKeys', () => {
    it('coerces a single string key into an array', () => {
      memIndex['foo'] = mkMeta({ key: 'foo', title: 'Foo', filePath: '/tmp/foo.md' });
      contentCache.set('foo', 'cached body');
      const res = getMemoriesByKeys({ keys: 'foo' });
      expect(res).toHaveLength(1);
      expect(res[0].key).toBe('foo');
      expect(res[0].content).toBe('cached body');
    });

    it('coerces mixed array elements to strings and reports missing keys', () => {
      memIndex['k2'] = mkMeta({ key: 'k2', title: 'K2', filePath: '/tmp/k2.md' });
      contentCache.set('k2', 'body');
      const res = getMemoriesByKeys({ keys: ['k2', 123, undefined] });
      expect(res.map((r: any) => r.key)).toEqual(['k2', '123', 'undefined']);
      expect(res[0].title).toBe('K2');
      expect(res[1].error).toBe('Not found');
      expect(res[2].error).toBe('Not found');
    });

    it('returns an empty array when keys is missing or not iterable', () => {
      expect(getMemoriesByKeys({})).toEqual([]);
      expect(getMemoriesByKeys({ keys: null })).toEqual([]);
      expect(getMemoriesByKeys({ keys: {} })).toEqual([]);
      expect(getMemoriesByKeys({ keys: 42 })).toEqual([]);
    });
  });

  describe('getTimeline', () => {
    it('returns items in the date window, sorted by updated desc', () => {
      memIndex['a'] = mkMeta({ key: 'a', updated: '2025-02-15T00:00:00.000Z' });
      memIndex['b'] = mkMeta({ key: 'b', updated: '2025-03-15T00:00:00.000Z' });
      memIndex['c'] = mkMeta({ key: 'c', updated: '2025-01-15T00:00:00.000Z' });

      const res = getTimeline({ since: '2025-02-01', limit: 1, offset: 0 });
      expect(res.total).toBe(2);
      expect(res.items.map((i: any) => i.key)).toEqual(['b']);
      expect(res.hasMore).toBe(true);

      const rest = getTimeline({ since: '2025-02-01', limit: 1, offset: 1 });
      expect(rest.items.map((i: any) => i.key)).toEqual(['a']);
      expect(rest.hasMore).toBe(false);
    });

    it('clamps huge/negative limit and offset', () => {
      for (let i = 0; i < 3; i++) {
        memIndex[`k${i}`] = mkMeta({
          key: `k${i}`,
          title: `T${i}`,
          updated: `2025-01-0${i + 1}T00:00:00.000Z`,
        });
      }
      const huge = getTimeline({ limit: 1e12, offset: 1e12 });
      expect(huge.items.length).toBe(0);
      expect(huge.hasMore).toBe(false);

      const nan = getTimeline({ limit: NaN, offset: NaN });
      expect(nan.items.length).toBe(3);
      expect(nan.total).toBe(3);
    });
  });

  describe('getRelatedMemories', () => {
    // Source memory + 5 related ones. All share tag 'x' so Jaccard > 0 and
    // every related memory is a candidate; same category 'src' adds a 0.2
    // boost but does not change ordering among them (all boosted equally).
    beforeEach(() => {
      memIndex['src'] = mkMeta({ key: 'src', tags: ['x'], category: 'src' });
      for (let i = 1; i <= 5; i++) {
        memIndex[`r${i}`] = mkMeta({ key: `r${i}`, tags: ['x'], category: 'src' });
      }
    });

    it('defaults to 10 and returns all related memories', () => {
      const res = getRelatedMemories({ key: 'src' });
      expect(res).toHaveLength(5);
    });

    it('clamps a malformed limit (negative/NaN/huge) to a safe value', () => {
      // Default (limit omitted) → all 5 (default is 10, only 5 candidates).
      expect(getRelatedMemories({ key: 'src' })).toHaveLength(5);
      // `limit: -1` pre-fix was `.slice(0, -1)` → 4 (drops the last); post-fix
      // clamps to min 1 → exactly 1.
      expect(getRelatedMemories({ key: 'src', limit: -1 })).toHaveLength(1);
      // `limit: NaN` pre-fix was `.slice(0, NaN)` → empty; post-fix → default 10 → all 5.
      expect(getRelatedMemories({ key: 'src', limit: NaN })).toHaveLength(5);
      // `limit: 1e12` post-fix clamps to MAX_PAGE_LIMIT (1000) → still all 5.
      expect(getRelatedMemories({ key: 'src', limit: 1e12 })).toHaveLength(5);
    });
  });

  describe('pruneMemories', () => {
    // 5 memories, all with retention strength ≤ 1 (importanceScore 0.5, no
    // recent access, accessCount 0). A threshold of 2 means strength < 2 is
    // true for every one of them, so all 5 are prune candidates — the slice
    // is observable.
    beforeEach(() => {
      for (let i = 1; i <= 5; i++) {
        memIndex[`p${i}`] = mkMeta({
          key: `p${i}`,
          importanceScore: 0.5,
          accessCount: 0,
          lastAccessed: '2025-01-01T00:00:00.000Z',
        });
      }
    });

    it('defaults to 20 and returns all candidates', () => {
      expect(pruneMemories({ threshold: 2 })).toHaveLength(5);
    });

    it('clamps a malformed limit (negative/NaN/huge) to a safe value', () => {
      // Default (limit omitted) → all 5 (default is 20, only 5 candidates).
      expect(pruneMemories({ threshold: 2 })).toHaveLength(5);
      // `limit: -1` pre-fix was `.slice(0, -1)` → 4; post-fix clamps to min 1 → 1.
      expect(pruneMemories({ threshold: 2, limit: -1 })).toHaveLength(1);
      // `limit: NaN` pre-fix was `.slice(0, NaN)` → empty; post-fix → default 20 → all 5.
      expect(pruneMemories({ threshold: 2, limit: NaN })).toHaveLength(5);
      // `limit: 1e12` post-fix clamps to MAX_PAGE_LIMIT (1000) → still all 5.
      expect(pruneMemories({ threshold: 2, limit: 1e12 })).toHaveLength(5);
    });
  });
});
