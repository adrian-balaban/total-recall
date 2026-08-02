import { computeRetentionStrength, daysSince } from './ebbinghaus.js';
import { memIndex, invertedIndex } from './state.js';
import { loadConfig } from './paths.js';

// 5.2 (REVIEW): per-doc length norm sqrt(totalTokens) for sublinear-TF length
// normalization. totalTokens = total token occurrences in the indexed text
// (title + tags + contentPreview). Maintained alongside the inverted index:
// rebuilt in rebuildInvertedIndex, set per-doc in registerDocument, dropped in
// deregisterDocument. Runtime-only (not persisted) — recomputed on boot, same
// as the inverted index itself. Dividing the raw TF-IDF score by this penalizes
// verbose memories so a query term isn't dominated by a doc that merely
// repeats it. The Map is module-level (one per process), mirroring invertedIndex.
const docLengths = new Map<string, number>();

// Per-doc term set (the terms a doc contributed to the inverted index), maintained
// alongside docLengths so deregisterDocument can remove a doc's postings by touching
// ONLY its own terms (O(unique-terms-in-doc)) instead of scanning every term's
// posting list (O(T), T≈all active terms). Without this, deregisterDocument — called
// on every store (re-register), update, AND delete — is O(T)≈O(N) per mutation, making
// a burst of writes O(N²): a 20k ADD collapsed 206/s→23/s as the index grew. Populated
// in rebuildInvertedIndex and registerDocument, cleared in deregisterDocument. The
// `has(key)` test is also the canonical "is this key currently registered" signal.
const docTerms = new Map<string, Set<string>>();

// O(1) running count of registered docs (mirrors Object.keys(memIndex).length).
// The per-store hot path needs N for the best-effort cached idf; computing it via
// Object.keys(memIndex).length is O(N) per store → O(N²) over a burst, the residual
// degradation (1135→759/s over 10k) after the deregister/idf fixes. A counter kept
// in lockstep with register/deregister/rebuild makes it O(1). tfidfSearch still uses
// Object.keys(memIndex).length (ground truth, once per query — infrequent), so a
// drifted counter only makes the UNUSED cached idf slightly off, never search.
let indexedDocCount = 0;

// ─── TF-IDF ──────────────────────────────────────────────────────────────────

// Stryker disable all: the RO/EN bilingual dictionary is data, not logic, and
// the bilingual query-expansion tests (tfidf-multilingual.test.ts) are excluded
// from Stryker's allow-list (they toggle ~/.total-recall/config.json, which
// collides with paths.ts's frozen CONFIG_PATH under Stryker's shared worker).
// Only English queries are used in practice, so the dict literals + the
// expansion branch below are not mutation targets — disabling them here keeps
// them from counting as surviving/no-coverage mutants. Restore below the block.
const BILINGUAL_DICT: Record<string, string> = {
  // Romanian -> English
  'decizie': 'decision',
  'decizii': 'decision',
  'sedinta': 'meeting',
  'sedinte': 'meeting',
  'intalnire': 'meeting',
  'intalniri': 'meeting',
  'concepte': 'concepts',
  // NOTE: no 'concept' entry — the RO and EN spellings are identical, so a
  // self-mapping ('concept' -> 'concept') would expand the query to
  // ['concept','concept'] and double-score every match on a PLAIN single-word
  // query, with no mixed-language input needed. The dedupe in tfidfSearch now
  // neutralizes it either way, but the entry buys nothing: never re-add a
  // key whose value equals itself.
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
// Stryker restore all

export function tokenize(text: string): string[] {
  // Preserve Romanian diacritics by normalizing to NFKD and stripping combining
  // marks, rather than replacing every non-ASCII character with a space. This
  // turns "întâlnire" into "intalnire" so it matches the bilingual dictionary
  // entries and keeps the base letters, instead of mangling it to "ntlnire".
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function deregisterDocument(key: string) {
  // Fast path: the doc's terms are tracked, so remove its postings from only
  // those terms — O(unique-terms-in-doc). This is the dominant fix for the O(N²)
  // write path: deregister is called on every store/update/delete, and the prior
  // unconditional `for (const t of Object.keys(invertedIndex))` scanned EVERY
  // term's posting list and rebuilt each via .filter even when the key was
  // absent — O(T)≈O(N) per mutation.
  const terms = docTerms.get(key);
  if (terms) {
    for (const t of terms) {
      const entry = invertedIndex[t];
      if (entry) {
        entry.docs = entry.docs.filter(d => d.key !== key);
        if (entry.docs.length === 0) {
          delete invertedIndex[t];
        }
      }
    }
    docTerms.delete(key);
    if (indexedDocCount > 0) indexedDocCount--;
  } else {
    // Fallback: the key isn't tracked (a deregister on a never-registered key,
    // or an index built before this tracking existed). Fall back to the full
    // scan for correctness. Rare and not on the burst hot path.
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
  // 5.2: drop the length norm when the doc leaves the index so a re-register
  // (different text) replaces it rather than reading a stale norm.
  docLengths.delete(key);
}

export function registerDocument(key: string, title: string, tags: string[], contentPreview: string) {
  // Only deregister if this key is already registered (an update/re-register with
  // changed text). A brand-new store's key is in no posting list, so the prior
  // unconditional deregisterDocument scanned every term (O(T)) for nothing on the
  // dominant burst-ADD path. docTerms tracks registration: set here on register,
  // cleared on deregister, populated for all memIndex keys by rebuildInvertedIndex.
  if (docTerms.has(key)) deregisterDocument(key);

  const tokens = tokenize(`${title} ${tags.join(' ')} ${contentPreview}`);
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;

  // N includes the doc being added: after the conditional deregister above,
  // indexedDocCount is (old-1) for a re-register or `old` for a new store, so
  // +1 yields the correct live doc count either way. O(1), not Object.keys.
  const N = indexedDocCount + 1;
  for (const [t, count] of Object.entries(tf)) {
    const entry = invertedIndex[t] ?? { docs: [], idf: 0 };
    entry.docs.push({ key, tf: count });
    // Best-effort idf for THIS term only (O(doc-terms), not O(all-terms)). Search
    // computes idf live per query token (see tfidfSearch), so this cached value is
    // not relied on for correctness — kept valid only so the field is never
    // stale-shaped and the persisted invertedIndex.json stays self-describing.
    entry.idf = Math.log((N + 1) / (entry.docs.length + 1)) + 1;
    invertedIndex[t] = entry;
  }

  // 5.2: cache sqrt(totalTokens) for this doc — the length norm used at score
  // time. totalTokens is the sum of the per-term tf counts (total token
  // occurrences in the indexed text), not the unique-term count.
  let totalTokens = 0;
  for (const c of Object.values(tf)) totalTokens += c;
  docLengths.set(key, Math.sqrt(totalTokens));
  // Track the doc's terms so a future deregister touches only these, not all T.
  docTerms.set(key, new Set(Object.keys(tf)));
  // A re-register already netted to zero (deregister decremented, this increments
  // back); a new store adds one. Either way the count stays in lockstep with memIndex.
  indexedDocCount++;
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
  // 5.2: rebuild the per-doc length-norm cache alongside the inverted index, and
  // the per-doc term set used by deregisterDocument's fast path.
  docLengths.clear();
  docTerms.clear();
  // Re-sync the O(1) doc counter to the freshly-rebuilt index's ground truth.
  indexedDocCount = N;
  for (const [key, tf] of Object.entries(tfByDoc)) {
    let totalTokens = 0;
    for (const [t, count] of Object.entries(tf)) {
      // Store the precomputed tf per (term, doc) so tfidfSearch never has to
      // re-tokenize the document body to score it (the prior O(Q·D·L) hot path).
      if (!invertedIndex[t]) invertedIndex[t] = { docs: [], idf: 0 };
      invertedIndex[t].docs.push({ key, tf: count });
      totalTokens += count;
    }
    docLengths.set(key, Math.sqrt(totalTokens));
    docTerms.set(key, new Set(Object.keys(tf)));
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
  // Stryker disable all: bilingual expansion branch — exercised only by
  // tfidf-multilingual.test.ts, which is excluded from Stryker's allow-list
  // (see BILINGUAL_DICT note above). Only English queries are used in practice.
  if (config.enableMultilingualSearch) {
    // Dedupe (first-seen order preserved). The dict is BIDIRECTIONAL — 17 of its
    // entries map both RO->EN and EN->RO — so a query containing a word AND its
    // translation collides: "decizie decision" expanded to
    // ['decizie','decision','decision','decizie']. The scoring loop below adds a
    // doc's (1+log tf)·idf·boost once PER TOKEN, so a doc matching 'decizie'
    // scored ~2x its monolingual baseline — an artifact of the translation step,
    // not genuine query-term frequency. A Set keyed on the token collapses the
    // duplicates while keeping first-seen order, so the title/tag boost path
    // still sees each distinct token exactly once.
    const seen = new Set<string>();
    const expanded: string[] = [];
    const push = (t: string) => { if (!seen.has(t)) { seen.add(t); expanded.push(t); } };
    for (const t of tokens) {
      push(t);
      const translated = BILINGUAL_DICT[t];
      if (translated) push(translated);
    }
    tokens = expanded;
  }
  // Stryker restore all
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
  // #5: memoize the tokenized title + tags per doc. The boost checks below
  // would otherwise tokenize meta.title and every meta.tags entry once per
  // (token, doc) match, but the tokenizations are constant per doc — a query
  // with Q tokens matching D docs paid Q·D title tokenize + Q·D·|tags| tag
  // tokenize allocations, all recomputing the same per-doc Sets. `token` is
  // already lowercased + NFKD-normalized by tokenize, so caching the tokenized
  // title/tags as Sets and testing .has(token) is one tokenize per doc per
  // query instead of one per (token, doc).
  const tokenCache = new Map<string, { titleTokens: Set<string>; tagTokens: Set<string> }>();

  // Compute idf LIVE per query token from the current total doc count N and the
  // term's live document frequency (entry.docs.length). The per-term idf cached in
  // the inverted index is NOT maintained eagerly on every write — recomputing it
  // for all active terms inside registerDocument was the O(T)≈O(N) hot spot that
  // collapsed ADD throughput (rate∝1/N: 206/s→23/s over 20k). Computing it here is
  // O(Q) (one per query token) and always correct regardless of cached-idf drift
  // between full rebuilds, so search ranking never depends on a stale cache.
  const N = Object.keys(memIndex).length;

  for (const token of tokens) {
    const entry = invertedIndex[token];
    if (!entry) continue;
    const idf = Math.log((N + 1) / (entry.docs.length + 1)) + 1;
    for (const doc of entry.docs) {
      const meta = memIndex[doc.key];
      if (!meta) continue;
      if (excludeJournal && meta.category === 'journal') continue;
      // tf is precomputed in rebuildInvertedIndex over title + tags + contentPreview,
      // so a tag-only match retains its tf here (no re-tokenization, no silent drop).
      // 5.2: sublinear TF (1 + log tf) biases against verbose memories — a doc that
      // repeats a term 10× contributes 1+log(10)≈3.3, not 10. tf≥1 for every indexed
      // (term, doc) so log is ≥0; the +1 keeps a single-occurrence term at weight 1.
      let score = (1 + Math.log(doc.tf)) * idf;
      let cached = tokenCache.get(doc.key);
      if (!cached) {
        cached = {
          titleTokens: new Set(tokenize(meta.title)),
          tagTokens: new Set(meta.tags.flatMap(t => tokenize(t))),
        };
        tokenCache.set(doc.key, cached);
      }
      // 5.1: exact token-match boost (was substring .includes). 'cat' no longer
      // boosts a doc titled 'Category theory' — only an exact token counts.
      if (cached.titleTokens.has(token)) score *= 2;
      if (cached.tagTokens.has(token)) score *= 1.5;
      rawScores[doc.key] = (rawScores[doc.key] ?? 0) + score;
    }
  }

  // Apply the per-doc Ebbinghaus decay once. Decay from lastAccessed (a real
  // retrieval), not `updated` — otherwise a memory never recalled after creation
  // decays from its creation date and a frequently-recalled one never decays at
  // all, both defeating the model. Fall back to `updated` for legacy index
  // entries lacking lastAccessed. 5.3: pass confirmations/flags so a confirmed
  // memory surfaces better in search (not just survives pruning) — the tool
  // promises exactly that. computeRetentionStrength's Number.isFinite guards
  // map undefined (legacy index entries) to 0.
  const scores: Array<{ key: string; score: number }> = [];
  for (const key of Object.keys(rawScores)) {
    const meta = memIndex[key]!;
    const decay = computeRetentionStrength(
      meta.importanceScore,
      daysSince(meta.lastAccessed || meta.updated),
      meta.accessCount,
      meta.confirmations,
      meta.flags,
    );
    // 5.2: divide by the per-doc length norm sqrt(totalTokens) so a verbose
    // memory's higher raw score (more term occurrences) doesn't dominate a
    // concise one matching the same terms. norm ≥ sqrt(1) > 0 always; the
    // `|| 1` guards a doc present in the index but missing from docLengths
    // (shouldn't happen, but a divide-by-zero would nuke the whole result).
    const norm = docLengths.get(key) || 1;
    scores.push({ key, score: (rawScores[key]! / norm) * decay });
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