import { memIndex, recordError } from '../state.js';
import { embed, embedTextFor } from '../embeddings.js';
import { getVectors, upsertVector } from '../vectorStore.js';
import { VECTORS_DB } from '../paths.js';
import { readCachedOrFresh, isReservedKey } from '../vault-scan.js';

// ─── Cosine similarity for normalized embeddings ───────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  // 3.2: the stored and query vectors must be the same length to be comparable.
  // The old Math.min(a.length, b.length) silently truncated the longer one — so
  // a 384-dim query scored against a 768-dim stored vector using only the first
  // 384 components, producing a plausible-but-garbage score. The caller now
  // guarantees equal lengths (the getVectors dim guard + the per-vector check
  // in rerankMemories re-embed on mismatch), so this is a defense-in-depth no-op
  // for equal lengths; for unequal it falls back to the overlap (better than
  // crashing) but the caller should never reach here with mismatched dims.
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom ? dot / denom : 0;
}

// ─── Semantic rerank tool ──────────────────────────────────────────────────────

const MAX_KEYS = 200;
// 3.10: bound the cold/empty-store case. After a table drop or fresh install,
// getVectors returns nothing and every candidate would hit a sequential embed()
// — up to MAX_KEYS (200) inference calls in one rerank. Cap the fresh-embed batch
// per call; the re-embedded vectors are PERSISTED (upsertVector) so the next
// rerank finds them stored and the store warms up one batch at a time instead of
// paying 200 embeds on every call until full. Candidates past the cap are scored
// 0 (preserving their original order at the bottom) rather than silently dropped,
// so the caller's key set isn't truncated.
const MAX_FRESH_EMBEDS_PER_CALL = 50;

export async function rerankMemories(args: any): Promise<any> {
  const { query, keys, full = false } = args;
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('query must be a non-empty string');
  }
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('keys must be a non-empty array');
  }

  // Clamp `limit` to a sensible page. Default = all provided keys.
  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(MAX_KEYS, Math.floor(requestedLimit))
    : keys.length;

  // Cap the candidate set itself so a huge `keys` array can't spam the embedder.
  // Drop reserved-key segments: they cannot be own properties in memIndex and
  // would otherwise resolve to Object.prototype when looked up.
  const candidateKeys = keys.slice(0, MAX_KEYS).map(String).filter(k => !isReservedKey(k));

  const qvec = await embed(query);
  if (!qvec) {
    // Graceful degradation: keep the caller's original order when no embedder is
    // available, matching the "always answer" policy used by recall_memory.
    return candidateKeys.map((key) => ({ key, score: 0 }));
  }

  const scored: Array<{
    key: string;
    score: number;
    meta: (typeof memIndex)[string];
  }> = [];

  // REVIEW 1.6: read already-stored vectors in one batch query instead of
  // re-embedding every candidate on every call — embedAndUpsert already wrote
  // them on store/update. Only candidates missing a stored vector (not yet
  // embedded, or vector deps absent) fall back to a fresh embed() call.
  // 3.2: pass qvec.length so getVectors can refuse to return rows from a
  // table built with a different dim (model change) instead of feeding
  // incomparable vectors into cosineSimilarity.
  const storedVectors = await getVectors(VECTORS_DB, candidateKeys, qvec.length);

  let freshEmbeds = 0;
  let missingCount = 0;
  for (const key of candidateKeys) {
    const meta = memIndex[key];
    if (!meta) continue;

    let mvec = storedVectors.get(key);
    // 3.2: a stored vector whose length disagrees with the query is
    // incomparable — treat it as missing and fall back to a fresh embed (the
    // getVectors table-level guard already short-circuits the all-mismatch case,
    // this covers a stray corrupt row).
    let attempted = false;
    if (!mvec || mvec.length !== qvec.length) {
      missingCount++;
      // 3.10: cap the fresh-embed batch so a cold/empty store can't spam 200
      // sequential embed() calls in one rerank. Persist the re-embedded vector so
      // the next rerank finds it stored (self-warming one batch per call).
      if (freshEmbeds < MAX_FRESH_EMBEDS_PER_CALL) {
        freshEmbeds++;
        attempted = true;
        const { content } = readCachedOrFresh(key, meta.filePath, 'reread');
        // 3.3: embed the canonical (title + body) text — the SAME shape
        // embedAndUpsert uses on the write path — so a re-embedded rerank vector
        // matches the vector that lands via store/update, and a title query finds
        // the memory.
        const body = content || meta.contentPreview || '';
        mvec = (await embed(embedTextFor(meta.title, body))) ?? undefined;
        if (mvec) upsertVector(VECTORS_DB, key, mvec).catch(() => {});
      }
    }
    if (mvec && mvec.length === qvec.length) {
      scored.push({ key, score: cosineSimilarity(qvec, mvec), meta });
    } else if (!attempted) {
      // 3.10: cap reached (didn't attempt a fresh embed) — score 0 so the
      // candidate still appears in its original-order position at the bottom
      // (the caller's key set isn't silently truncated); it warms on a later rerank.
      scored.push({ key, score: 0, meta });
    }
    // else: attempted but embed() returned null → skip (can't score, matches the
    // existing "skips a candidate whose embedding returns null" contract).
  }

  // 3.10: make the cap observable so a cold store isn't a silent degrade.
  if (missingCount > MAX_FRESH_EMBEDS_PER_CALL) {
    recordError(
      `rerank_memories: ${missingCount} candidates missing stored vectors, capped fresh-embed batch ` +
      `at ${MAX_FRESH_EMBEDS_PER_CALL} (${missingCount - MAX_FRESH_EMBEDS_PER_CALL} scored 0 this call; ` +
      `persisted vectors warm the store for the next rerank)`
    );
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  return top.map((r) => {
    const m = r.meta;
    if (full) {
      const { content } = readCachedOrFresh(r.key, m.filePath, 'reread');
      return {
        key: r.key,
        score: r.score,
        title: m.title,
        category: m.category,
        tags: m.tags,
        updated: m.updated,
        content,
      };
    }
    return {
      key: r.key,
      score: r.score,
      title: m.title,
      category: m.category,
      tags: m.tags,
      updated: m.updated,
      preview: m.contentPreview,
    };
  });
}
