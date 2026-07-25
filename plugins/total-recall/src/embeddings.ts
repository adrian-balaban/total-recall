/**
 * HuggingFace embedding model — the single embedding provider. Lazy-loaded
 * from vector/node_modules; if @huggingface/transformers is not installed, all
 * methods are no-ops and search degrades to TF-IDF.
 *
 * Phase 0: the external-provider registry (Ollama HTTP daemon) was removed
 * entirely. Embedding is now always the in-process transformer pipeline —
 * there is no network endpoint, no circuit breaker, no timeout class, and no
 * "down/hung daemon" state to manage. The only failure mode is load-time
 * (optional dep missing or model download hiccup), handled here by NOT
 * caching a failed load (3.9): the next embed() retries instead of being
 * latched to null for the process lifetime.
 */
import { VECTORS_DB, loadConfig } from './paths.js';
import { upsertVector } from './vectorStore.js';
import { recordError } from './state.js';

let pipeline: ((text: string) => Promise<number[]>) | null = null;
let loadPromise: Promise<((text: string) => Promise<number[] | null>) | null> | null = null;
let testEmbedder: ((text: string) => Promise<number[] | null>) | null | undefined = undefined;

/**
 * Test-only seam: inject a fake embedder (or `null` to force the unavailable
 * fallback) without loading the real optional dependency. The env guard
 * prevents accidental use in production; Vitest sets NODE_ENV=test.
 */
export function __testSetEmbedder(
  embedder: ((text: string) => Promise<number[] | null>) | null
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__testSetEmbedder is test-only');
  }
  if (embedder === null) {
    // Simulate "model unavailable": getEmbedder returns null.
    testEmbedder = null;
    loadPromise = Promise.resolve(null);
    pipeline = null;
  } else {
    testEmbedder = embedder;
    loadPromise = Promise.resolve(embedder);
    pipeline = embedder as (text: string) => Promise<number[]>;
  }
}

// getEmbedder resolves to the in-process HuggingFace embed function:
//   - lazy-load the model once, cache the promise (loadPromise) so concurrent
//     callers during the first load share one pipeline;
//   - an advanced user may override the model via config.embeddingModel
//     (default Xenova/all-MiniLM-L6-v2, 384-dim).
// A load failure is NOT cached (3.9): loadPromise is cleared in the catch so
// the next embed() retries — a first-run model-download hiccup no longer
// permanently disables vectors for the session.
async function getEmbedder(): Promise<((text: string) => Promise<number[] | null>) | null> {
  if (testEmbedder !== undefined) return testEmbedder;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { pipeline: hfPipeline } = await import('@huggingface/transformers');
      const model = loadConfig().embeddingModel || 'Xenova/all-MiniLM-L6-v2';
      const extractor = await hfPipeline('feature-extraction', model);
      pipeline = async (text: string) => {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data as Float32Array);
      };
      return pipeline;
    } catch {
      // Don't cache the failure: clear loadPromise so the next call retries
      // (mirrors vectorStore.getDb "only cache successful loads"). A transient
      // model-download error shouldn't latch vectors off for the whole session.
      pipeline = null;
      loadPromise = null;
      return null;
    }
  })();
  return loadPromise;
}

export async function embed(text: string): Promise<number[] | null> {
  const embedder = await getEmbedder();
  if (!embedder) return null;
  // Let a per-call inference error propagate: the fire-and-forget write path's
  // .catch attributes it under the key prefix (embedAndUpsert(key): …), and the
  // read-path callers wrap embed() in their own try/catch (recall_memory) or
  // surface it (rerank) — preserving the pre-Phase-0 behavior rather than
  // swallowing it as a silent null.
  return await embedder(text);
}

// Fire-and-forget embed → upsert. Centralized so the two write paths (store +
// update) share one implementation, and so the lazy load, the no-op-when-deps-
// absent path, and the null-skip when the model returns nothing are owned
// in one place. A transient embed or upsert failure (e.g. a sqlite I/O error
// mid-upsert) is recorded via `recordError` — the bounded sink surfaced through
// `get_stats.recentErrors` — so a holed vector index is observable rather than
// silently swallowed. It still never blocks the caller's response. A later
// store/update at the same key re-attempts INSERT OR REPLACE, so a transient
// failure does not permanently hole the index; reconcileIndex's boot backfill
// (vault-scan.ts) closes any pre-existing hole.
//
// The promise is tracked in `pendingEmbeds` so flushEmbeddings() — awaited on
// the SIGTERM/SIGINT exit path (index.ts) before process.exit — can land the
// vector for a write whose fire-and-forget upsert hadn't resolved yet. Without
// it, exiting between a store_memory and its embed landing permanently holed
// the vector index for that key (findable via TF-IDF, invisible to hybrid
// search) — the same silent-drop class the v1.0.28 concurrent-load fix
// addressed, but via the exit path. reconcileIndex's boot backfill
// (vault-scan.ts) closes pre-existing holes; this closes new ones.
const pendingEmbeds = new Set<Promise<void>>();

export function embedAndUpsert(key: string, text: string): void {
  const p = embed(text)
    .then(vec => { if (vec) return upsertVector(VECTORS_DB, key, vec); })
    .catch(e => { recordError(`embedAndUpsert(${key}): ${e instanceof Error ? e.message : String(e)}`); });
  pendingEmbeds.add(p);
  p.finally(() => pendingEmbeds.delete(p));
}

// Await in-flight embed/upsert promises, bounded by `timeoutMs`, so the
// SIGTERM/SIGINT handler can land last-write vectors before process.exit. A
// promise that exceeds the timeout is left to settle in the background; its
// key is backfilled on the next boot if it still misses. No-op when nothing is
// pending (the common exit path — keeps shutdown fast).
export async function flushEmbeddings(timeoutMs = 2000): Promise<void> {
  if (pendingEmbeds.size === 0) return;
  const snapshot = [...pendingEmbeds];
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>(r => { timer = setTimeout(r, timeoutMs); });
  try {
    await Promise.race([Promise.allSettled(snapshot), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Honest signal: true only once the pipeline has actually loaded. Used for
// reporting (get_stats) so a fresh session with no optional deps installed does
// not falsely advertise vector search as enabled. The recall hybrid gate does not
// consult this — it always attempts embed() when hybrid is requested and degrades
// to TF-IDF via the embed()->null path, which is what triggers the lazy load.
export function isVectorAvailable(): boolean {
  if (testEmbedder !== undefined && testEmbedder !== null) return true;
  if (testEmbedder === null) return false;
  return pipeline !== null;
}

/** Test-only seam: reset the embedder state so each test starts clean. */
export function __testResetVectorAvailability(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__testResetVectorAvailability is test-only');
  }
  // Clear the test-embedder seam: a prior test that called __testSetEmbedder(null)
  // (e.g. the "model unavailable" case) leaves testEmbedder=null, which makes
  // getEmbedder() return null for EVERY later test — embed() then bails before
  // loading the pipeline. Resetting here keeps tests isolated by file order.
  testEmbedder = undefined;
  pipeline = null;
  loadPromise = null;
}