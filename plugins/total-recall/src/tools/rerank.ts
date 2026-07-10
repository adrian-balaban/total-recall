import { memIndex } from '../state.js';
import { embed } from '../embeddings.js';
import { readCachedOrFresh, isReservedKey } from '../vault-scan.js';

// ─── Cosine similarity for normalized embeddings ───────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
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

  for (const key of candidateKeys) {
    const meta = memIndex[key];
    if (!meta) continue;

    const { content } = readCachedOrFresh(key, meta.filePath, 'reread');
    const textToEmbed = `${meta.title}\n\n${content || meta.contentPreview || ''}`.slice(0, 2000);
    const mvec = await embed(textToEmbed);
    if (!mvec) continue;

    scored.push({ key, score: cosineSimilarity(qvec, mvec), meta });
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
