import * as fs from 'fs';
import { parseFrontmatter } from '../frontmatter.js';
import { VECTORS_DB } from '../paths.js';
import { tfidfSearch } from '../tfidf.js';
import { toCutoff, inDateWindow } from '../dates.js';
import { memIndex } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { scheduleSave } from '../persistence.js';
import { embed } from '../embeddings.js';
import { searchVector } from '../vectorStore.js';
import { reciprocalRankFusion } from '../rrf.js';
import { assertRegularFile } from '../vault-scan.js';

export async function recallMemory(args: any): Promise<any> {
  const { query, full = false, since, before, minScore = 0, limit = 10, excludeJournal = true, hybrid = true } = args;
  const tfidfResults = tfidfSearch(query, excludeJournal);

  // Optional hybrid path: fuse the TF-IDF rank (already decay-weighted by Ebbinghaus
  // inside tfidfSearch) with vector nearest-neighbour rank via Reciprocal Rank Fusion.
  // Falls back to TF-IDF only when embeddings are unavailable or the query fails to embed.
  let ranked: Array<{ key: string; score: number }>;
  // Always attempt the vector path when hybrid is requested; embed() returns null
  // (and stays a cheap cached no-op) when the optional deps are absent, so this
  // both triggers the lazy load on first use and degrades to TF-IDF gracefully.
  if (hybrid) {
    try {
      const qvec = await embed(query);
      if (qvec) {
        const vecResults = await searchVector(VECTORS_DB, qvec, 50);
        const fused = reciprocalRankFusion([tfidfResults, vecResults]);
        // RRF returns a Map keyed by first-seen order (TF-IDF rank), NOT by fused
        // score — sort by score desc before slicing so the top-N reflect the fused
        // ranking rather than the TF-IDF insertion order.
        ranked = [...fused.entries()].map(([key, score]) => ({ key, score }))
          .sort((a, b) => b.score - a.score);
      } else {
        ranked = tfidfResults;
      }
    } catch {
      ranked = tfidfResults;
    }
  } else {
    ranked = tfidfResults;
  }

  // Hybrid fusion can surface journal entries via the vector ranking even when
  // excludeJournal=true: tfidfSearch excluded them, but searchVector does not, so
  // the fused list may contain journal keys. Re-apply the journal filter before
  // date/limit narrowing so recall_memory(hybrid=true, excludeJournal=true) does
  // not leak journal entries. (No-op for the TF-IDF-only and excludeJournal=false
  // paths: the former is already filtered, the latter opts in to journal.)
  if (excludeJournal) {
    ranked = ranked.filter(r => memIndex[r.key]?.category !== 'journal');
  }

  // Date filters silently exclude memories with a missing/Invalid `updated` —
  // mirrors `list_memories` (see CLAUDE.md "Key Gotchas"). inDateWindow resolves
  // the cutoffs ONCE (toCutoff throws on a bad bound, same throw point as the old
  // per-block calls) and applies the [since, before) window in a single pass; a
  // missing `updated` returns false (the drop is the safest fallback for
  // externally-authored files that predate the field). The `if (lower || upper)`
  // guard preserves the no-filter behavior: when neither bound is given the old
  // code skipped both blocks and kept every entry, so we skip the filter too
  // (keeping memories that lack `updated`, which a window check would drop).
  const lower = since ? toCutoff(since) : null;
  const upper = before ? toCutoff(before) : null;
  if (lower || upper) {
    ranked = ranked.filter(r => inDateWindow(memIndex[r.key]?.updated, lower, upper));
  }

  // Minimum-score floor (mirrors danilop/claude-total-recall's `threshold`):
  // drop results whose (fused or TF-IDF) score is below this. Default 0 = no
  // filtering, byte-identical to prior behavior. NOTE scores are NOT comparable
  // across hybrid modes — RRF-fused scores are tiny (~1/(60+rank)) while raw
  // TF-IDF scores are larger; tune minScore for the mode you call with, or pass
  // hybrid=false for a predictable TF-IDF threshold scale.
  if (minScore > 0) {
    ranked = ranked.filter(r => r.score >= minScore);
  }

  ranked = ranked.slice(0, limit);

  return ranked.map(r => {
    const meta = memIndex[r.key];
    if (!meta) return null;
    if (full) {
      // Only a real content retrieval counts as an "access" that resets the
      // Ebbinghaus decay clock (lastAccessed) and bumps accessCount. A
      // metadata-only recall must NOT — otherwise every lightweight search
      // refreshes lastAccessed, memories never decay, and prune_memories can
      // never nominate the rarely-read ones it's meant to surface.
      meta.accessCount++;
      meta.lastAccessed = new Date().toISOString();
      scheduleSave();
      let content = contentCache.get(r.key);
      if (!content) {
        try {
          // Symlink containment (mirrors store.ts/mutate.ts via
          // assertRegularFile): meta.filePath is lexically inside the vault but
          // can be a symlink a teammate swapped in via the org vault's git pull
          // AFTER the boot-time reconcileIndex that rejects symlinks at scan. The
          // MCP server is long-lived and does not re-scan mid-session, so without
          // this guard readFileSync follows the link and leaks the target into
          // `content` (-> MCP response -> LLM context). Fail closed into the
          // catch below (content='') instead of following.
          assertRegularFile(meta.filePath, r.key);
          const raw = fs.readFileSync(meta.filePath, 'utf8');
          content = parseFrontmatter(raw).content; // strip YAML frontmatter
          // Only cache successful reads — a transient read failure (race, lock)
          // must not poison the LRU with '' for 30 min, or every later full recall
          // returns empty content until the entry expires/evicts.
          contentCache.set(r.key, content!);
        } catch { content = ''; }
      }
      return { ...meta, content, score: r.score };
    }
    return { ...meta, score: r.score };
  }).filter(Boolean);
}

export function searchIndex(args: any): any {
  const { query, limit = 20, since, before, minScore = 0, excludeJournal = true, category, tags: filterTags } = args;
  let results = tfidfSearch(query, excludeJournal);

  // Same single-pass date window as recall_memory above (see the comment there):
  // resolve the bounds once, apply the [since, before) window via inDateWindow,
  // and skip the filter entirely when neither bound is given (keeps entries
  // that lack `updated`, which a window check would silently drop).
  const lower = since ? toCutoff(since) : null;
  const upper = before ? toCutoff(before) : null;
  if (lower || upper) {
    results = results.filter(r => inDateWindow(memIndex[r.key]?.updated, lower, upper));
  }
  if (category) results = results.filter(r => memIndex[r.key]?.category === category);
  if (filterTags?.length) results = results.filter(r => filterTags.every((t: string) => memIndex[r.key]?.tags.includes(t)));

  // Minimum-score floor (mirrors danilop/claude-total-recall's `threshold`).
  // Default 0 = no filtering (current behavior). search_index is TF-IDF-only,
  // so scores are on the raw TF-IDF scale (no RRF rescale caveat here).
  if (minScore > 0) results = results.filter(r => r.score >= minScore);

  return results.slice(0, limit).map(r => {
    const m = memIndex[r.key];
    return m
      ? { key: r.key, title: m.title, category: m.category, tags: m.tags, updated: m.updated, score: r.score, preview: m.contentPreview, estimatedTokens: m.tokenEstimate }
      : null;
  }).filter(Boolean);
}