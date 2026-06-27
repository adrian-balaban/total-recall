import * as fs from 'fs';
import { parseFrontmatter } from '../frontmatter.js';
import { computeRetentionStrength, daysSince } from '../ebbinghaus.js';
import { toCutoff } from '../dates.js';
import { memIndex, errors, perfSamples } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { scheduleSave } from '../persistence.js';
import { isVectorAvailable } from '../embeddings.js';

export function listMemories(args: any): any {
  const { category, tag, limit = 50, offset = 0 } = args;
  const filtered = Object.values(memIndex)
    .filter(m => (!category || m.category === category) && (!tag || m.tags.includes(tag)))
    .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  const total = filtered.length;
  const items = filtered
    .slice(offset, offset + limit)
    .map(({ key, title, category, tags, updated, importanceScore, tokenEstimate }) => ({
      key, title, category, tags, updated, importanceScore, tokenEstimate,
    }));
  return { items, total, hasMore: offset + limit < total };
}

export function getMemoriesByKeys(args: any): any {
  const { keys, summary = false } = args;
  return keys.map((key: string) => {
    const meta = memIndex[key];
    if (!meta) return { key, error: 'Not found' };
    // Defer the access-count bump until a read actually succeeds. Previously the
    // bump + scheduleSave ran unconditionally before the read, so a vanished file
    // (meta present, file gone) inflated accessCount/lastAccessed and triggered a
    // debounced save for a memory that just errored — skewing retention/pruning
    // stats and persisting state for a broken key.
    const bumpAccess = () => {
      meta.accessCount++;
      meta.lastAccessed = new Date().toISOString();
      scheduleSave();
    };
    if (summary) {
      // Guard the read like the full-content path does: if the file vanished between
      // index load and this read, surface a per-key error rather than crashing the
      // whole batch.
      let content = '';
      try {
        const raw = fs.readFileSync(meta.filePath, 'utf8');
        content = parseFrontmatter(raw).content;
      } catch {
        return { key, error: 'Failed to read memory file' };
      }
      bumpAccess();
      const execSummary = content.match(/^## Executive Summary\n+([\s\S]{0,500})/m)?.[1] ?? content.slice(0, 500);
      return { key, title: meta.title, category: meta.category, tags: meta.tags, summary: execSummary.trim() };
    }
    let content = contentCache.get(key);
    let readOk = !!content;
    if (!content) {
      try {
        const raw = fs.readFileSync(meta.filePath, 'utf8');
        content = parseFrontmatter(raw).content; // strip YAML frontmatter
        // Only cache successful reads — a transient failure must not poison the
        // LRU with '' for 30 min (every later get_memories_by_keys(full) on this
        // key would return empty until the entry expires/evicts).
        contentCache.set(key, content!);
        readOk = true;
      } catch { content = ''; }
    }
    if (readOk) bumpAccess();
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
    performance: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) },
    recentErrors: errors.slice(-10),
    vectorSearchEnabled: isVectorAvailable(),
  };
}

export function getTimeline(args: any): any {
  const { since, before, limit = 50, offset = 0, category } = args;
  const cutoff = since ? toCutoff(since) : new Date(0);
  // Symmetric upper bound — mirrors `since`; combine for a date-range window.
  const upper = before ? toCutoff(before) : null;
  const filtered = Object.values(memIndex)
    .filter(m => new Date(m.updated) >= cutoff && (!upper || new Date(m.updated) < upper) && (!category || m.category === category))
    .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  const total = filtered.length;
  const items = filtered
    .slice(offset, offset + limit)
    .map(m => ({ key: m.key, title: m.title, category: m.category, tags: m.tags, updated: m.updated }));
  return { items, total, hasMore: offset + limit < total };
}

export function getRelatedMemories(args: any): any {
  const { key, limit = 10, includeContent = false } = args;
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
    .slice(0, limit);
}

export function pruneMemories(args: any): any {
  const { threshold = 0.1, limit = 20 } = args;
  return Object.values(memIndex)
    .map(m => ({
      key: m.key, title: m.title, category: m.category,
      retentionStrength: computeRetentionStrength(m.importanceScore, daysSince(m.lastAccessed || m.updated), m.accessCount),
      lastAccessed: m.lastAccessed, importanceScore: m.importanceScore,
    }))
    .filter(m => m.retentionStrength < threshold)
    .sort((a, b) => a.retentionStrength - b.retentionStrength)
    .slice(0, limit);
}