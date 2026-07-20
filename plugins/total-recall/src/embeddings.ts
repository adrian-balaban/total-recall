/**
 * Optional HuggingFace embedding model — lazy-loaded from vector/node_modules.
 * If @huggingface/transformers is not installed, all methods are no-ops.
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

// One bounded attempt at the Ollama embed endpoint. AbortController turns a
// hung request (Ollama busy loading/swapping another model) into a clean
// timeout instead of an indefinite fetch — the plugin has no other watchdog
// on this call, and embed() is awaited on the read path (recall_memory with
// hybrid=true), so a stuck fetch would stall that request until the OS-level
// socket timeout (or forever, for some proxies).
async function ollamaEmbedAttempt(
  url: string, model: string, text: string, timeoutMs: number
): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Ollama returned status ${response.status}`);
    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  } finally {
    clearTimeout(timer);
  }
}

async function getExternalEmbedding(text: string): Promise<number[] | null> {
  const config = loadConfig();
  const provider = config.embeddingProvider || 'huggingface';

  if (provider === 'ollama') {
    const url = config.embeddingUrl || 'http://127.0.0.1:11434/api/embeddings';
    const model = config.embeddingModel || 'bge-m3';
    const timeoutMs = config.embeddingTimeoutMs ?? 10000;

    try {
      return await ollamaEmbedAttempt(url, model, text, timeoutMs);
    } catch {
      // One retry after a short backoff. Observed failure mode (2026-07-11):
      // Ollama returns a bare HTTP 500 while it's busy loading/evicting another
      // large model from VRAM — a few hundred ms later the same request
      // succeeds. A single retry absorbs that class of transient failure
      // without turning a genuinely-down Ollama into a multi-attempt stall
      // (still just 2 bounded attempts, each capped at timeoutMs).
      await new Promise(r => setTimeout(r, 200));
      try {
        return await ollamaEmbedAttempt(url, model, text, timeoutMs);
      } catch (e) {
        // Reset the availability latch on failure: otherwise a single earlier
        // success keeps isVectorAvailable() reporting true for the whole session
        // even after Ollama has died. REVIEW 1.4.
        externalEmbedSuccess = false;
        recordError(`Ollama embedding failed after retry: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }
  }

  return null;
}

async function getEmbedder(): Promise<((text: string) => Promise<number[] | null>) | null> {
  if (testEmbedder !== undefined) return testEmbedder;
  const config = loadConfig();
  const provider = config.embeddingProvider || 'huggingface';
  if (provider !== 'huggingface') {
    return getExternalEmbedding;
  }
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { pipeline: hfPipeline } = await import('@huggingface/transformers');
      const extractor = await hfPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      pipeline = async (text: string) => {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data as Float32Array);
      };
      return pipeline;
    } catch {
      pipeline = null;
      return null;
    }
  })();
  return loadPromise;
}

export async function embed(text: string): Promise<number[] | null> {
  const embedder = await getEmbedder();
  if (!embedder) return null;
  const result = await embedder(text);
  if (Array.isArray(result)) externalEmbedSuccess = true;
  return result;
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
// True once an external provider (Ollama) has returned a valid vector.
// We do not probe on every get_stats call, so availability is reported honestly
// only after an actual embed attempt succeeded.
let externalEmbedSuccess = false;

export function isVectorAvailable(): boolean {
  if (testEmbedder !== undefined && testEmbedder !== null) return true;
  if (testEmbedder === null) return false;
  const config = loadConfig();
  const provider = config.embeddingProvider || 'huggingface';
  if (provider !== 'huggingface') return externalEmbedSuccess;
  return pipeline !== null;
}

/** Test-only seam: reset the external-provider success flag so each test starts clean. */
export function __testResetVectorAvailability(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__testResetVectorAvailability is test-only');
  }
  externalEmbedSuccess = false;
}
