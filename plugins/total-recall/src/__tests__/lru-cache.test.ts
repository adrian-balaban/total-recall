import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LRUCache, contentCache } from '../lru-cache.js';

// Dedicated unit tests for lru-cache.ts. Before these existed the module was
// only exercised INDIRECTLY (via query/vault-scan tests), which left its
// mutation score at 48.15% — the boundaries (`>` on expiry, `>=` on maxSize),
// the hit/miss counters, and the literals of the exported `contentCache` had no
// test that could tell a mutated version from the real one. Every block below
// targets a specific mutant class; if you loosen an assertion, say which mutant
// still dies.

describe('LRUCache', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('get — miss, expiry boundary, counters', () => {
    it('returns undefined and counts a miss for an absent key', () => {
      const c = new LRUCache<string, number>(4, 1000);
      expect(c.get('nope')).toBeUndefined();
      expect(c.stats()).toEqual({ hits: 0, misses: 1, size: 0 });
    });

    it('counts a hit and leaves size unchanged on a live key', () => {
      const c = new LRUCache<string, number>(4, 1000);
      c.set('a', 1);
      expect(c.get('a')).toBe(1);
      expect(c.stats()).toEqual({ hits: 1, misses: 0, size: 1 });
    });

    // Kills the `>` → `>=` mutant on `Date.now() > entry.expiry`: an entry whose
    // expiry is EXACTLY now must still be a hit. With `>=` this read as expired.
    it('treats an entry at exactly its expiry instant as still live', () => {
      const c = new LRUCache<string, number>(4, 1000);
      c.set('a', 1);                 // expiry = t0 + 1000
      vi.advanceTimersByTime(1000);  // now === expiry
      expect(c.get('a')).toBe(1);
      expect(c.stats().hits).toBe(1);
    });

    // The other side of the same boundary: one tick past expiry must miss.
    it('expires an entry one millisecond past its expiry', () => {
      const c = new LRUCache<string, number>(4, 1000);
      c.set('a', 1);
      vi.advanceTimersByTime(1001);
      expect(c.get('a')).toBeUndefined();
      expect(c.stats().misses).toBe(1);
    });

    // Kills removal of the `this.map.delete(key)` inside the miss branch: an
    // expired entry must be EVICTED by the failed read, not merely reported
    // missing — otherwise it occupies a slot forever.
    it('evicts the expired entry it just failed to read', () => {
      const c = new LRUCache<string, number>(4, 1000);
      c.set('a', 1);
      expect(c.stats().size).toBe(1);
      vi.advanceTimersByTime(1001);
      c.get('a');
      expect(c.stats().size).toBe(0);
    });

    // Kills removal of the delete/re-set pair in the hit path (LRU promotion).
    it('promotes a key to most-recently-used on read', () => {
      const c = new LRUCache<string, number>(2, 10_000);
      c.set('a', 1);
      c.set('b', 2);
      c.get('a');        // 'a' becomes MRU, so 'b' is now the eviction victim
      c.set('c', 3);     // at capacity → evict LRU
      expect(c.get('a')).toBe(1);
      expect(c.get('b')).toBeUndefined();
      expect(c.get('c')).toBe(3);
    });
  });

  describe('set — capacity boundary and in-place refresh', () => {
    // Kills `>=` → `>` on the maxSize check: at exactly maxSize a new key must
    // evict. With `>` the cache silently grew to maxSize + 1.
    it('evicts the least-recently-used entry when inserting at capacity', () => {
      const c = new LRUCache<string, number>(2, 10_000);
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3);
      expect(c.stats().size).toBe(2);
      expect(c.get('a')).toBeUndefined();
    });

    it('never exceeds maxSize across many inserts', () => {
      const c = new LRUCache<string, number>(3, 10_000);
      for (let i = 0; i < 25; i++) c.set(`k${i}`, i);
      expect(c.stats().size).toBe(3);
      expect(c.get('k24')).toBe(24);
    });

    // The documented reason the `has(key)` branch exists: updating an existing
    // key must NOT evict an innocent entry. Kills removal of that branch.
    it('refreshes an existing key in place without evicting anyone', () => {
      const c = new LRUCache<string, number>(2, 10_000);
      c.set('a', 1);
      c.set('b', 2);
      c.set('a', 99);          // update, not insert — 'b' must survive
      expect(c.stats().size).toBe(2);
      expect(c.get('b')).toBe(2);
      expect(c.get('a')).toBe(99);
    });

    // The second half of that comment: an updated key must also move to MRU.
    it('promotes an updated key to most-recently-used', () => {
      const c = new LRUCache<string, number>(2, 10_000);
      c.set('a', 1);
      c.set('b', 2);
      c.set('a', 99);   // 'a' → MRU, so 'b' is the victim
      c.set('c', 3);
      expect(c.get('b')).toBeUndefined();
      expect(c.get('a')).toBe(99);
    });

    // Kills arithmetic mutation of `Date.now() + this.ttlMs` (e.g. `-`), which
    // would make every entry expire immediately.
    it('honours the configured TTL rather than expiring at once', () => {
      const c = new LRUCache<string, number>(4, 5_000);
      c.set('a', 1);
      vi.advanceTimersByTime(4_999);
      expect(c.get('a')).toBe(1);
      vi.advanceTimersByTime(2);
      expect(c.get('a')).toBeUndefined();
    });
  });

  describe('delete and stats', () => {
    it('removes an entry without touching the hit/miss counters', () => {
      const c = new LRUCache<string, number>(4, 10_000);
      c.set('a', 1);
      c.delete('a');
      expect(c.stats()).toEqual({ hits: 0, misses: 0, size: 0 });
      expect(c.get('a')).toBeUndefined();
    });

    it('deleting an absent key is a no-op', () => {
      const c = new LRUCache<string, number>(4, 10_000);
      c.set('a', 1);
      c.delete('ghost');
      expect(c.stats().size).toBe(1);
    });

    it('accumulates hits and misses independently', () => {
      const c = new LRUCache<string, number>(4, 10_000);
      c.set('a', 1);
      c.get('a'); c.get('a');
      c.get('x'); c.get('y'); c.get('z');
      expect(c.stats()).toEqual({ hits: 2, misses: 3, size: 1 });
    });
  });

  // The exported singleton's constructor literals are mutable too — pin them
  // behaviourally, since the fields are private.
  describe('contentCache singleton', () => {
    it('caps at 100 entries', () => {
      for (let i = 0; i < 130; i++) contentCache.set(`cc-${i}`, `v${i}`);
      expect(contentCache.stats().size).toBe(100);
      contentCache.delete('cc-129');
    });

    // Kills arithmetic mutants on `30 * 60 * 1000` (a 30-minute TTL).
    it('uses a 30-minute TTL', () => {
      contentCache.set('ttl-probe', 'v');
      vi.advanceTimersByTime(30 * 60 * 1000 - 1);
      expect(contentCache.get('ttl-probe')).toBe('v');
      vi.advanceTimersByTime(2);
      expect(contentCache.get('ttl-probe')).toBeUndefined();
    });
  });
});
