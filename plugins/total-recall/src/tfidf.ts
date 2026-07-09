import { computeRetentionStrength, daysSince } from './ebbinghaus.js';
import { memIndex, invertedIndex } from './state.js';
import { loadConfig } from './paths.js';

// ─── TF-IDF ──────────────────────────────────────────────────────────────────

const BILINGUAL_DICT: Record<string, string> = {
  // Romanian -> English
  'decizie': 'decision',
  'decizii': 'decision',
  'sedinta': 'meeting',
  'sedinte': 'meeting',
  'intalnire': 'meeting',
  'intalniri': 'meeting',
  'concepte': 'concepts',
  'concept': 'concept',
  'arhitectura': 'architecture',
  'arhitecturi': 'architecture',
  'problema': 'troubleshooting',
  'probleme': 'troubleshooting',
  'depanare': 'troubleshooting',
  'jurnal': 'journal',
  'jurnale': 'journal',
  'memorie': 'memory',
  'memorii': 'memories',
  'salvare': 'store',
  'actualizare': 'update',
  'stergere': 'delete',

  // English -> Romanian
  'decision': 'decizie',
  'meeting': 'sedinta',
  'concepts': 'concepte',
  'architecture': 'arhitectura',
  'troubleshooting': 'problema',
  'journal': 'jurnal',
  'memories': 'memorii',
  'memory': 'memorie',
};

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

export function deregisterDocument(key: string) {
  for (const t of Object.keys(invertedIndex)) {
    const entry = invertedIndex[t];
    if (entry) {
      entry.docs = entry.docs.filter(d => d.key !== key);
      if (entry.docs.length === 0) {
        delete invertedIndex[t];
      }
    }
  }
}

export function registerDocument(key: string, title: string, tags: string[], contentPreview: string) {
  deregisterDocument(key);

  const tokens = tokenize(`${title} ${tags.join(' ')} ${contentPreview}`);
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;

  for (const [t, count] of Object.entries(tf)) {
    if (!invertedIndex[t]) {
      invertedIndex[t] = { docs: [], idf: 0 };
    }
    invertedIndex[t]!.docs.push({ key, tf: count });
  }

  // Recalculate IDFs for all active terms
  const N = Object.keys(memIndex).length;
  for (const t of Object.keys(invertedIndex)) {
    invertedIndex[t]!.idf = Math.log((N + 1) / (invertedIndex[t]!.docs.length + 1)) + 1;
  }
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
    // invertedIndex[t] was just iterated from the same object above, so it
    // is guaranteed present here.
    invertedIndex[t]!.idf = Math.log((N + 1) / (docFreq[t]! + 1)) + 1;
  }
}

export function tfidfSearch(query: string, excludeJournal = true): Array<{ key: string; score: number }> {
  const config = loadConfig();
  let tokens = tokenize(query);
  if (config.enableMultilingualSearch) {
    const expanded: string[] = [];
    for (const t of tokens) {
      expanded.push(t);
      const translated = BILINGUAL_DICT[t];
      if (translated) expanded.push(translated);
    }
    tokens = expanded;
  }
  // #22: accumulate RAW tf×idf (with per-token title/tag boosts) per doc across
  // all query tokens, then multiply by the Ebbinghaus decay ONCE per doc after
  // the token loop. The decay is a per-doc scalar — it depends only on
  // importanceScore / lastAccessed / accessCount, none of which vary with the
  // token — so `Σ_t (score_t × decay) == decay × Σ_t score_t`. The prior code
  // recomputed computeRetentionStrength (→ daysSince → new Date) inside the
  // inner (token, doc) loop, so a doc matching K query tokens paid K decay
  // recomputations for the same constant multiplier. Algebraically identical
  // output (not an approximation); just one decay eval per matched doc.
  const rawScores: Record<string, number> = {};
  // #5: memoize the lowercased title + tags per doc. The boost checks below call
  // toLowerCase on meta.title and every meta.tags entry once per (token, doc)
  // match, but the lower casings are constant per doc — a query with Q tokens
  // matching D docs paid Q·D title toLowerCase + Q·D·|tags| tag toLowerCase
  // allocations, all recomputing the same per-doc strings. `token` is already
  // lowercased by tokenize, so caching the lowercased title/tags and comparing
  // with .includes(token) is algebraically identical output, just one toLowerCase
  // per doc per query instead of one per (token, doc).
  const lowCache = new Map<string, { titleLow: string; tagsLow: string[] }>();

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
      let low = lowCache.get(doc.key);
      if (!low) {
        low = { titleLow: meta.title.toLowerCase(), tagsLow: meta.tags.map(t => t.toLowerCase()) };
        lowCache.set(doc.key, low);
      }
      if (low.titleLow.includes(token)) score *= 2;
      if (low.tagsLow.some(t => t.includes(token))) score *= 1.5;
      rawScores[doc.key] = (rawScores[doc.key] ?? 0) + score;
    }
  }

  // Apply the per-doc Ebbinghaus decay once. Decay from lastAccessed (a real
  // retrieval), not `updated` — otherwise a memory never recalled after creation
  // decays from its creation date and a frequently-recalled one never decays at
  // all, both defeating the model. Fall back to `updated` for legacy index
  // entries lacking lastAccessed.
  const scores: Array<{ key: string; score: number }> = [];
  for (const key of Object.keys(rawScores)) {
    const meta = memIndex[key]!;
    const decay = computeRetentionStrength(
      meta.importanceScore,
      daysSince(meta.lastAccessed || meta.updated),
      meta.accessCount
    );
    scores.push({ key, score: rawScores[key]! * decay });
  }

  // #23: full sort, not partial top-K selection. Two reasons this is intentional:
  //   1. recall_memory feeds the FULL ranked list into Reciprocal Rank Fusion
  //      (rrf.ts) against the vector nearest-neighbour ranks. RRF needs every
  //      tfidf rank — a doc ranked 15th by TF-IDF but 1st by vector must survive
  //      to be fused. Truncating to the caller's `limit` (10) before fusion would
  //      silently drop cross-method matches and degrade hybrid recall, so the
  //      caller-side `limit` cannot be pushed down into tfidfSearch.
  //   2. search_index does slice to `limit` (20), but at personal scale this is
  //      sorting a few hundred numbers — sub-ms, dwarfed by the MCP stdio
  //      round-trip and the optional hybrid embed cost. A partial-selection
  //      (quickselect / size-limited heap) path would only pay off beyond a few
  //      thousand memories and adds non-trivial ranking-correctness risk for a
  //      sub-ms win. Verified not actionable at personal scale; revisit only if
  //      vault size grows into the thousands.
  return scores.sort((a, b) => b.score - a.score);
}