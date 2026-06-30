/**
 * Optional HuggingFace embedding model — lazy-loaded from vector/node_modules.
 * If @huggingface/transformers is not installed, all methods are no-ops.
 */
import { VECTORS_DB } from './paths.js';
import { upsertVector } from './vectorStore.js';
import { recordError } from './state.js';

let pipeline: ((text: string) => Promise<number[]>) | null = null;
let loadPromise: Promise<((text: string) => Promise<number[]>) | null> | null = null;

async function getEmbedder(): Promise<((text: string) => Promise<number[]>) | null> {
  // Cache the *promise*, not a `loadAttempted` boolean. The previous code set
  // loadAttempted=true synchronously (before the `await import` resolved), so a
  // concurrent caller arriving mid-load saw the flag set but `pipeline` still
  // null, returned null, and embedAndUpsert's `if (vec) upsertVector(...)` then
  // SILENTLY SKIPPED the vector upsert for that key — a permanent hole in the
  // vector index. The race is reachable in practice: embedAndUpsert is
  // fire-and-forget (store.ts / mutate.ts don't await it), so the server is free
  // to process a second store_memory — or a hybrid recall_memory — during the
  // seconds-to-minutes @huggingface/transformers import + model init, and the
  // losing writer drops its vector. A failed load caches a promise that resolves
  // to null, so subsequent callers also get null (no retry) — matching the prior
  // no-retry-on-failure semantics. Mirrors vectorStore.ts getDb (lines 13-17),
  // which was rewritten for the identical bug class. `pipeline` is still mutated
  // inside the load body so isVectorAvailable() flips true only once loaded.
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
  return embedder(text);
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
  return pipeline !== null;
}
