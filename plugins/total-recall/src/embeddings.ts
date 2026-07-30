/**
 * HuggingFace embedding model — the single embedding provider. Lazy-loaded
 * from vector/node_modules; if @huggingface/transformers is not installed, all
 * methods are no-ops and search degrades to TF-IDF. The only failure mode is
 * load-time (optional dep missing, a bad embeddingModel id, or a model download
 * hiccup), handled here by NOT caching a failed load (3.9): the next embed()
 * retries instead of being latched to null for the process lifetime. A failed
 * load is also surfaced — once per process — via a stderr warning + recordError
 * (see getEmbedder's catch), so the degradation is observable rather than
 * silent: vector search silently off was the exact footgun a bad embeddingModel
 * (e.g. a bare "bge-m3" with no org/ prefix) produced before this.
 */
import { VECTORS_DB, CONFIG_PATH, loadConfig } from './paths.js';
import { upsertVector } from './vectorStore.js';
import { recordError, memIndex } from './state.js';

let pipeline: ((text: string) => Promise<number[]>) | null = null;
let loadPromise: Promise<((text: string) => Promise<number[] | null>) | null> | null = null;
let testEmbedder: ((text: string) => Promise<number[] | null>) | null | undefined = undefined;
// Once-per-process latch for the embedder-load-failure warning. A persistent
// bad embeddingModel re-runs the (uncached) load on every embed() — without this
// latch, a 523-memory backfill would emit 523 identical warnings. The load still
// retries (the no-cache contract below); only the warning is deduped.
let embedderLoadWarned = false;

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

/**
 * Test-only seam: drop the injected/test embedder back to the pristine
 * module-load state (testEmbedder = undefined, no cached loadPromise, no
 * pipeline, warning latch cleared) so a test can exercise the REAL
 * getEmbedder() load path (the dynamic `import('@huggingface/transformers')`
 * + `hfPipeline(...)` + catch) instead of the `__testSetEmbedder` short-circuit.
 * The env guard mirrors `__testSetEmbedder`.
 */
export function __testResetEmbedder(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__testResetEmbedder is test-only');
  }
  testEmbedder = undefined;
  loadPromise = null;
  pipeline = null;
  embedderLoadWarned = false;
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
  // Hoisted out of the try so the catch can name the configured model in its
  // warning. loadConfig() never throws (paths.ts wraps stat+read+parse in
  // catch, returning defaults on any failure), so this can't escape getEmbedder.
  const model = loadConfig().embeddingModel || 'Xenova/all-MiniLM-L6-v2';
  loadPromise = (async () => {
    try {
      const { pipeline: hfPipeline } = await import('@huggingface/transformers');
      const extractor = await hfPipeline('feature-extraction', model);
      pipeline = async (text: string) => {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data as Float32Array);
      };
      return pipeline;
    } catch (err) {
      // Don't cache the failure: clear loadPromise so the next call retries
      // (mirrors vectorStore.getDb "only cache successful loads"). A transient
      // model-download error shouldn't latch vectors off for the whole session.
      pipeline = null;
      loadPromise = null;
      // Make the failure LOUD once per process. Before this, a bad embeddingModel
      // (e.g. a bare "bge-m3" with no org/ prefix, or any id the HF hub 404s on)
      // failed this load, returned null, and recall_memory(hybrid=true) SILENTLY
      // degraded to TF-IDF — vector search advertised but never functional, with
      // no signal anywhere except a buried get_stats.recentErrors entry. recordError
      // keeps it in the bounded sink; the one-shot stderr warning surfaces it on
      // the channel a developer actually reads, naming the model and the config
      // key to fix. Once-per-process (embedderLoadWarned) so a persistent bad id
      // doesn't spam a warning per embed during a multi-thousand-memory backfill —
      // the load itself still retries (the no-cache contract above), only the
      // warning is deduped. A transient failure that later succeeds leaves one
      // stale line; that's acceptable noise next to the value of surfacing the
      // persistent footgun this was added to catch.
      if (!embedderLoadWarned) {
        embedderLoadWarned = true;
        const reason = err instanceof Error ? err.message : String(err);
        recordError(
          `embedding model failed to load: "${model}" — ${reason}. ` +
          `Vector search is OFF; recall_memory(hybrid) falls back to TF-IDF. ` +
          `Fix embeddingModel in ${CONFIG_PATH} (use a full "org/model" HuggingFace id, ` +
          `e.g. "Xenova/paraphrase-multilingual-MiniLM-L12-v2").`
        );
        process.stderr.write(
          `[total-recall] WARNING: embedding model "${model}" failed to load — ${reason}\n` +
          `[total-recall] Vector search is OFF; recall_memory(hybrid) silently falls back to TF-IDF.\n` +
          `[total-recall] Set embeddingModel in ${CONFIG_PATH} to a valid "org/model" HuggingFace id and restart.\n`
        );
      }
      return null;
    }
  })();
  return loadPromise;
}

// Canonical text fed to the embedder for a (title, body) memory (3.3). The
// title is prefixed (blank-line separated) so a memory's vector reflects its
// heading as well as its body. Before this helper existed, the two write/read
// paths used DIFFERENT text shapes: rerank_memories embedded `${title}\n\n
// ${body}` while embedAndUpsert embedded only the body — so a stored vector
// (body-only) and a freshly-computed rerank vector (title+body) for the SAME
// key could disagree, and a query for a memory's title found nothing. One
// helper, used by every path, makes them agree. The body is sliced to
// EMBED_BODY_SLICE (MiniLM-L6 truncates at 256 tokens anyway, so a longer body
// adds no signal — the slice loses nothing and bounds the embed input).
export const EMBED_BODY_SLICE = 2000;
export function embedTextFor(title: string, body: string): string {
  return `${title || ''}\n\n${(body || '').slice(0, EMBED_BODY_SLICE)}`;
}

export async function embed(text: string): Promise<number[] | null> {
  const embedder = await getEmbedder();
  if (!embedder) return null;
  // Let a per-call inference error propagate: the fire-and-forget write path's
  // .catch attributes it under the key prefix (embedAndUpsert(key): …), and the
  // read-path callers wrap embed() in their own try/catch (recall_memory) or
  // surface it (rerank) — preserving the pre-Phase-0 behavior rather than
  // swallowing it as a silent null.
  const vec = await embedder(text);
  // 3.4: a model that returns a non-array or empty array would otherwise flow
  // unchecked into upsertVector (which guards length but not type) and into
  // cosine/searchVector where an empty vector silently scores 0 and a
  // non-array throws mid-loop. Treat it as a per-call failure, record it, and
  // return null so callers degrade (rerank skips the candidate, embedAndUpsert
  // null-skips the write, recall falls back to TF-IDF) instead of corrupting
  // the index with a zero-length row. isVectorAvailable() is unaffected — it
  // reflects pipeline-load state, not a single call's output.
  if (!Array.isArray(vec) || vec.length === 0) {
    recordError(
      `embed: model returned ${Array.isArray(vec) ? 'empty' : 'non-array'} vector ` +
      `for text of length ${text.length}`
    );
    return null;
  }
  return vec;
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

export function embedAndUpsert(key: string, body: string): void {
  // 3.3: embed the CANONICAL (title + body) text so a memory's vector reflects
  // its heading — matching what rerank_memories computes for the same key, so a
  // stored vector and a fresh rerank vector agree (and a title query finds the
  // memory). The title is looked up from memIndex at call time (already
  // populated by the time any write path reaches here). The (key, body)
  // signature is preserved so store/update call sites and their tests stay
  // unchanged; body is sliced inside embedTextFor (MiniLM truncates past 256
  // tokens, so the slice loses no signal).
  const title = memIndex[key]?.title ?? '';
  const p = embed(embedTextFor(title, body))
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

// Honest "are the optional deps installed AND loadable" probe — distinct from
// isVectorAvailable(), which only answers "has the HF pipeline LAZY-loaded yet".
// On a fresh session with no embed()/rerank/hybrid call yet, the pipeline has
// never loaded, so isVectorAvailable() returns false even when every dep is
// fully functional — get_stats then reported `depsPresent: false` /
// `vectorSearchEnabled: false`, making vector search look disabled when it was
// merely idle. That drove users to "fix" a non-problem (and to miss the REAL
// footgun — a missing better-sqlite3 native binding, which `claude plugin
// update` leaves source-only because it doesn't re-run install.sh).
//
// depsInstalled() probes what actually matters: can @huggingface/transformers
// be imported, can sqlite-vec be imported, and can better-sqlite3 instantiate a
// Database (the binding test — `new Database(':memory:')` throws "Could not
// locate binding file" when build/Release/better_sqlite3.node is absent, which
// is exactly the post-update failure mode). It does NOT load the HF model
// (no network, no multi-hundred-ms cost) and does NOT touch the vectors DB
// file — a pure capability probe with no side effects.
//
// A `true` result is latched per-process (deps don't appear mid-session); a
// `false` result is re-probed each call so a self-heal rebuild (vectorStore's
// getDb catch) that lands the binding mid-session is reflected on the next
// get_stats without needing a restart.
let depsCachedTrue = false;
let testDepsInstalled: boolean | null = null;

async function probeDeps(): Promise<boolean> {
  try {
    const hf = await import('@huggingface/transformers');
    if (typeof (hf as any).pipeline !== 'function') return false;
    const sv = await import('sqlite-vec');
    if (typeof (sv as any).getLoadablePath !== 'function' && typeof (sv as any).load !== 'function') return false;
    const Database = (await import('better-sqlite3')).default;
    // The binding test: this throws when build/Release/better_sqlite3.node is
    // absent (the post-`claude plugin update` source-only state). :memory:
    // avoids creating/touching the on-disk vectors DB.
    const d = new Database(':memory:');
    d.close();
    return true;
  } catch {
    return false;
  }
}

export async function depsInstalled(): Promise<boolean> {
  if (testDepsInstalled !== null) return testDepsInstalled;
  if (depsCachedTrue) return true;
  const ok = await probeDeps();
  if (ok) depsCachedTrue = true;
  return ok;
}

/** Test-only seam: inject a depsInstalled result (or `null` to use the real probe). */
export function __testSetDepsInstalled(v: boolean | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__testSetDepsInstalled is test-only');
  }
  testDepsInstalled = v;
  depsCachedTrue = v === true;
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