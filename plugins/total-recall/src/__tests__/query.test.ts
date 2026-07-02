import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listMemories, getMemoriesByKeys, getTimeline } from '../tools/query.js';
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
});
