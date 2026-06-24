import { computeRetentionStrength, daysSince } from './ebbinghaus.js';
import { memIndex, invertedIndex } from './state.js';

// ─── TF-IDF ──────────────────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

export function rebuildInvertedIndex() {
  const docFreq: Record<string, number> = {};
  const tfByDoc: Record<string, Record<string, number>> = {};
  const N = Object.keys(memIndex).length;

  for (const [key, meta] of Object.entries(memIndex)) {
    const tokens = tokenize(`${meta.title} ${meta.tags.join(' ')} ${meta.contentPreview}`);
    const tf: Record<string, number> = {};
    for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
    tfByDoc[key] = tf;
    for (const t of Object.keys(tf)) {
      docFreq[t] = (docFreq[t] ?? 0) + 1;
    }
  }

  // Clear-then-populate the shared singleton (formerly `invertedIndex = {}`).
  for (const t of Object.keys(invertedIndex)) delete invertedIndex[t];
  for (const [key, tf] of Object.entries(tfByDoc)) {
    for (const [t, count] of Object.entries(tf)) {
      // Store the precomputed tf per (term, doc) so tfidfSearch never has to
      // re-tokenize the document body to score it (the prior O(Q·D·L) hot path).
      if (!invertedIndex[t]) invertedIndex[t] = { docs: [], idf: 0 };
      invertedIndex[t].docs.push({ key, tf: count });
    }
  }
  for (const t of Object.keys(invertedIndex)) {
    invertedIndex[t].idf = Math.log((N + 1) / (docFreq[t] + 1)) + 1;
  }
}

export function tfidfSearch(query: string, excludeJournal = true): Array<{ key: string; score: number }> {
  const tokens = tokenize(query);
  const scores: Record<string, number> = {};

  for (const token of tokens) {
    const entry = invertedIndex[token];
    if (!entry) continue;
    for (const doc of entry.docs) {
      const meta = memIndex[doc.key];
      if (!meta) continue;
      if (excludeJournal && meta.category === 'journal') continue;
      // tf is precomputed in rebuildInvertedIndex over title + tags + contentPreview,
      // so a tag-only match retains its tf here (no re-tokenization, no silent drop).
      let score = doc.tf * entry.idf;
      if (meta.title.toLowerCase().includes(token)) score *= 2;
      if (meta.tags.some(t => t.toLowerCase().includes(token))) score *= 1.5;
      // Decay from lastAccessed (a real retrieval), not `updated` — otherwise a
      // memory never recalled after creation decays from its creation date and a
      // frequently-recalled one never decays at all, both defeating the Ebbinghaus
      // model. Fall back to `updated` for legacy index entries lacking lastAccessed.
      const decay = computeRetentionStrength(
        meta.importanceScore,
        daysSince(meta.lastAccessed || meta.updated),
        meta.accessCount
      );
      scores[doc.key] = (scores[doc.key] ?? 0) + score * decay;
    }
  }

  return Object.entries(scores)
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score);
}