import { computeRetentionStrength, daysSince } from '../ebbinghaus.js';
import { toCutoff, inDateWindow } from '../dates.js';
import { memIndex, errors, perfSamples, bumpAccess } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { isVectorAvailable } from '../embeddings.js';
import { readMemoryContent, readCachedOrFresh } from '../vault-scan.js';
import { NO_PRUNE_TAG } from '../paths.js';
import type { MemoryMetadata } from '../types.js';

// Pagination bounds: the MCP schema advertises limit/offset as numbers, but a
// buggy/malicious caller can pass values that are huge, negative, or NaN.
// Coerce, clamp, and provide safe defaults at the query boundary.
const MAX_PAGE_LIMIT = 1000;
const MAX_PAGE_OFFSET = 1_000_000;

// #20: Schwartzian transform for the by-`updated`-descending sort shared by
// list_memories and get_timeline. The prior inline comparator constructed two
// `new Date` objects per comparison — ~2·N·log N Date allocations per
// paginated call (and the same work repeats on every page, since both tools
// re-filter + re-sort the whole memIndex each request). Parse `updated` to ms
// once per doc, sort by the precomputed number, then map back to the metadata.
// `new Date(m.updated).getTime()` is NaN for a missing/garbage `updated`; NaN
// sorts to the end under `b[0] - a[0]` (NaN comparisons return false → elements
// keep their relative order), matching the prior comparator's behavior.
function sortByUpdatedDesc(metas: MemoryMetadata[]): MemoryMetadata[] {
  return metas
    .map(m => [new Date(m.updated).getTime(), m] as const)
    .sort((a, b) => b[0] - a[0])
    .map(pair => pair[1]);
}

export function listMemories(args: any): any {
  const { category, tag } = args;
  const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(Number(args.limit)))) || 50;
  const offset = Math.max(0, Math.min(MAX_PAGE_OFFSET, Math.floor(Number(args.offset)))) || 0;
  const filtered = sortByUpdatedDesc(
    Object.values(memIndex)
      .filter(m => (!category || m.category === category) && (!tag || m.tags.includes(tag)))
  );
  const total = filtered.length;
  const items = filtered
    .slice(offset, offset + limit)
    .map(({ key, title, category, tags, updated, importanceScore, tokenEstimate }) => ({
      key, title, category, tags, updated, importanceScore, tokenEstimate,
    }));
  return { items, total, hasMore: offset + limit < total };
}

export function getMemoriesByKeys(args: any): any {
  // keys may arrive as a single string, a mixed array, or missing. Coerce to a
  // clean string array at the boundary so the read path never throws on a
  // non-iterable value and non-string elements are safely stringified.
  const rawKeys = Array.isArray(args.keys)
    ? args.keys
    : typeof args.keys === 'string'
      ? [args.keys]
      : [];
  const keys = rawKeys.map((k: unknown) => (typeof k === 'string' ? k : String(k)));
  const { summary = false } = args;
  return keys.map((key: string) => {
    const meta = memIndex[key];
    if (!meta) return { key, error: 'Not found' };
    // Defer the access-count bump until a read actually succeeds. Previously the
    // bump + scheduleSave ran unconditionally before the read, so a vanished file
    // (meta present, file gone) inflated accessCount/lastAccessed and triggered a
    // debounced save for a memory that just errored — skewing retention/pruning
    // stats and persisting state for a broken key.
    if (summary) {
      // readMemoryContent owns the swapped-symlink guard (see vault-scan.ts):
      // null = failed read (vanished file, swapped symlink, parse error) → surface
      // a per-key error rather than crashing the whole batch; '' = a real empty body
      // → the exec-summary regex misses and falls back to slice(0,500) of ''. No
      // cache on the summary path.
      const body = readMemoryContent(meta.filePath, key);
      if (body === null) return { key, error: 'Failed to read memory file' };
      bumpAccess(meta);
      const execSummary = body.match(/^## Executive Summary\n+([\s\S]{0,500})/m)?.[1] ?? body.slice(0, 500);
      return { key, title: meta.title, category: meta.category, tags: meta.tags, summary: execSummary.trim() };
    }
    // LRU-or-read via the shared helper (see vault-scan.ts readCachedOrFresh).
    // `onEmpty: 'reread'` preserves this site's truthy-`!content` policy: a cached
    // '' triggers a fresh fs read (the original behavior). bumpAccess runs only
    // on hit OR fresh-success (status: 'failed' means the read returned null —
    // vanished file, swapped symlink, parse error — and the prior code deferred
    // the bump in that case so a broken key can't inflate accessCount).
    const { status, content } = readCachedOrFresh(key, meta.filePath, 'reread');
    if (status !== 'failed') bumpAccess(meta);
    return { ...meta, key, content };
  });
}

export function getStats(): any {
  const byCategory: Record<string, number> = {};
  for (const m of Object.values(memIndex)) {
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
  }
  const perf = [...perfSamples].sort((a, b) => a - b);
  const pct = (p: number) => perf[Math.floor(perf.length * p)] ?? 0;
  return {
    total: Object.keys(memIndex).length,
    byCategory,
    cache: contentCache.stats(),
    performance: { samples: perf.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) },
    recentErrors: errors.slice(-10),
    vectorSearchEnabled: isVectorAvailable(),
  };
}

export function getTimeline(args: any): any {
  const { since, before, category } = args;
  const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(Number(args.limit)))) || 50;
  const offset = Math.max(0, Math.min(MAX_PAGE_OFFSET, Math.floor(Number(args.offset)))) || 0;
  // Default the lower bound to the epoch so a timeline with no `since` still
  // excludes entries lacking a valid `updated`: inDateWindow returns false for a
  // missing `updated` whenever a lower bound is present (and `cutoff` is never
  // null here), matching the prior `new Date(m.updated) >= new Date(0)` behavior.
  // `upper` is the symmetric exclusive upper bound; combine for a date-range window.
  const cutoff = since ? toCutoff(since) : new Date(0);
  const upper = before ? toCutoff(before) : null;
  const filtered = sortByUpdatedDesc(
    Object.values(memIndex)
      .filter(m => inDateWindow(m.updated, cutoff, upper) && (!category || m.category === category))
  );
  const total = filtered.length;
  const items = filtered
    .slice(offset, offset + limit)
    .map(m => ({ key: m.key, title: m.title, category: m.category, tags: m.tags, updated: m.updated }));
  return { items, total, hasMore: offset + limit < total };
}

export function getRelatedMemories(args: any): any {
  const { key, includeContent = false } = args;
  // Coerce + clamp limit (mirrors listMemories above): MCP does not enforce
  // the inputSchema, so a negative/NaN/huge limit must not produce a wrong slice.
  const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(Number(args.limit)))) || 10;
  const source = memIndex[key];
  if (!source) throw new Error(`Memory not found: ${key}`);

  const srcTags = new Set(source.tags);
  return Object.values(memIndex)
    .filter(m => m.key !== key)
    .map(m => {
      // Dedupe m.tags before Jaccard: the union/intersection cardinalities must be
      // over SETS, but `srcTags` is a Set and `m.tags` is an Array — a tag repeated
      // in m.tags would inflate the denominator (union) without adding to the
      // intersection, deflating the score. Normalize both sides.
      const mTags = new Set(m.tags);
      let shared = 0;
      for (const t of mTags) if (srcTags.has(t)) shared++;
      // Jaccard similarity on TAGS with a same-category boost. A memory with no
      // shared tags is not "related" — the same-category boost must amplify an
      // existing tag overlap, not manufacture a relation from nothing. Without
      // this guard, every same-category memory with disjoint tags leaks in at
      // score 0.2 (0 Jaccard + 0.2 boost).
      if (shared === 0) return null;
      const categoryBoost = m.category === source.category ? 0.2 : 0;
      return { key: m.key, title: m.title, category: m.category, tags: m.tags, score: shared / (srcTags.size + mTags.size - shared) + categoryBoost };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(m => {
      // `includeContent` is advertised in the schema but was previously
      // ignored — callers that opted in got the same payload as default. Honor
      // it now: read through the LRU first (mirrors recall_memory's full path)
      // and fall back to a one-shot fs read. Do NOT bump accessCount / lastAccessed
      // here — get_related_memories is a discovery query, not a "read"; an entry
      // surfaced as related-but-never-read should still decay (mirrors the
      // recall_memory(full=false) policy in recall.ts).
      if (!includeContent) return m;
      const meta = memIndex[m.key];
      if (!meta) return m;
      // LRU-or-read via the shared helper (vault-scan.ts readCachedOrFresh).
      // Default `onEmpty: 'hit'` preserves this site's strict-`=== undefined`
      // policy: a cached '' is a HIT and is NOT re-read (intentional difference
      // from recall_memory / get_memories_by_keys, which re-read a cached empty).
      // No access bump regardless of status — this is a discovery query.
      const { content } = readCachedOrFresh(m.key, meta.filePath);
      return { ...m, content };
    });
}

export function pruneMemories(args: any): any {
  const { threshold = 0.1 } = args;
  // Coerce + clamp limit (mirrors listMemories above): MCP does not enforce the
  // inputSchema, so a negative/NaN/huge limit must not produce a wrong slice.
  const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(Number(args.limit)))) || 20;
  return Object.values(memIndex)
    .map(m => ({
      key: m.key, title: m.title, category: m.category,
      retentionStrength: computeRetentionStrength(
        m.importanceScore,
        daysSince(m.lastAccessed || m.updated),
        m.accessCount,
        m.confirmations,
        m.flags,
      ),
      lastAccessed: m.lastAccessed, importanceScore: m.importanceScore,
      tags: m.tags,
    }))
    // Exclude immortal memories BEFORE the retention filter so they never count
    // toward `limit` either. The `no-prune` tag is an explicit per-memory opt-in
    // (e.g. an ADR); the `decisions` category is intentionally NOT auto-protected
    // — not every decision is immortal. See NO_PRUNE_TAG in paths.ts.
    .filter(m => !m.tags.includes(NO_PRUNE_TAG))
    .filter(m => m.retentionStrength < threshold)
    .sort((a, b) => a.retentionStrength - b.retentionStrength)
    .slice(0, limit);
}