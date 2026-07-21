/**
 * Optional HuggingFace embedding model — lazy-loaded from vector/node_modules.
 * If @huggingface/transformers is not installed, all methods are no-ops.
 */
import { VECTORS_DB, loadConfig } from './paths.js';
import { upsertVector } from './vectorStore.js';
import { recordError } from './state.js';
import { PROVIDERS, EmbedTimeoutError } from './embeddings/providers.js';

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

// External (stateless per-call) embedding providers live in
// ./embeddings/providers.ts as a PROVIDERS registry — adding a provider = one
// entry there, no if/else here. embeddings.ts owns the cross-provider
// orchestration: the HuggingFace lazy-load + in-flight-promise cache, the
// externalEmbedSuccess availability latch, and the test seam.
//
// getEmbedder resolves the configured provider to an embed function:
//   - huggingface: lazy-load the model once, cache the promise (loadPromise);
//   - any other name: look it up in PROVIDERS and return a closure that calls
//     its embed() with a fresh loadConfig() per call (so a runtime config
//     change is picked up, matching the pre-registry behavior). An unknown
//     provider name resolves to no embedder → embed() returns null and no
//     transport call is attempted (clean TF-IDF fallback for a typo or an
//     as-yet-unimplemented provider).
async function getEmbedder(): Promise<((text: string) => Promise<number[] | null>) | null> {
  if (testEmbedder !== undefined) return testEmbedder;
  const config = loadConfig();
  const provider = config.embeddingProvider || 'huggingface';
  if (provider === 'huggingface') {
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
  const p = PROVIDERS[provider];
  if (!p) return null;
  // Re-read config per embed so a runtime toggle (url/model/timeout) takes
  // effect without a restart, exactly as the pre-registry getExternalEmbedding
  // did by calling loadConfig() inside each embed.
  return (text: string) => p.embed(text, loadConfig());
}

export async function embed(text: string): Promise<number[] | null> {
  // Circuit breaker (REVIEW 1.2): if an external provider has failed
  // CIRCUIT_OPEN_THRESHOLD times in a row, short-circuit to null for the
  // cooldown without awaiting the (likely hung) provider. A hybrid recall then
  // degrades to TF-IDF immediately instead of stalling ~2×timeout per call.
  if (circuitOpenUntil) {
    if (Date.now() < circuitOpenUntil) return null;
    // Cooldown elapsed: half-open probe. Clear the open marker but keep the
    // failure count so a probe failure re-opens immediately; a probe success
    // clears it. Only one call per cooldown window gets to probe.
    circuitOpenUntil = 0;
  }

  const embedder = await getEmbedder();
  if (!embedder) return null;
  let result: number[] | null;
  try {
    result = await embedder(text);
  } catch (e) {
    // Provider contract: throw EmbedTimeoutError ONLY for a reachable-but-slow
    // endpoint (REVIEW 1.6). A timeout is not a "down" failure — Ollama is
    // healthy, just slower than embeddingTimeoutMs — so it must NOT count
    // toward the session circuit breaker: without this exemption, three cold
    // bge-m3 recalls on a CPU laptop would force-disable vectors for 60s on a
    // working daemon. Degrade this call to TF-IDF, reset the availability latch
    // honestly (isVectorAvailable reflects "last embed succeeded"), and emit
    // one targeted hint naming the knob — instead of the generic "provider
    // failed" warning that misleads users into thinking Ollama is down.
    if (e instanceof EmbedTimeoutError) {
      externalEmbedSuccess = false;
      if (!timeoutWarned) {
        timeoutWarned = true;
        console.error(
          `[total-recall] embedding timed out after ${e.timeoutMs}ms — the model is ` +
          `reachable but slow (common for bge-m3 on CPU, ~12s cold). Hybrid search ` +
          `fell back to TF-IDF for this query. Raise "embeddingTimeoutMs" in ` +
          `~/.total-recall/config.json if this is persistent.`
        );
      }
      return null;
    }
    // Any other throw is a provider bug. The production Ollama provider never
    // throws here (it catches its own errors and returns null), so reaching
    // this branch means a test seam or a buggy custom provider. Re-throw so the
    // fire-and-forget write path's .catch attributes it under the key prefix
    // (embedAndUpsert(key): …) and the read-path caller sees it — preserving
    // the pre-timeout-classification behavior rather than swallowing it as a
    // generic "provider threw" error.
    throw e;
  }
  // Centralized availability latch for external providers (REVIEW 1.4): set on
  // success, RESET on failure. Previously each provider's catch reset it; with
  // the registry the latch is managed once here so every provider gets the same
  // "the last embed attempt actually succeeded" semantics without re-implementing
  // it. Only consulted by isVectorAvailable() when provider !== 'huggingface';
  // for HuggingFace the pipeline latch is the signal and this stays unused.
  externalEmbedSuccess = Array.isArray(result);

  // Update the circuit breaker only for external providers — HuggingFace's
  // failure mode is load-time (missing dep), not a per-call hung endpoint.
  // Success closes the circuit (resets the count); failure bumps it and may
  // open it. An unknown provider returns no embedder and bailed above, so it
  // never counts as a failure (a config typo shouldn't open the circuit).
  const provider = loadConfig().embeddingProvider || 'huggingface';
  if (provider !== 'huggingface') {
    if (externalEmbedSuccess) {
      consecutiveFailures = 0;
      // Recovery: re-arm the down-episode warning so a fresh outage warns again.
      vectorDownWarned = false;
      // Also re-arm the timeout hint: a fresh slow-episode deserves a fresh line.
      timeoutWarned = false;
    } else {
      // REVIEW 1.3: one stderr warning at the start of this down-episode, so a
      // user who never calls get_stats still sees hybrid search degrade to
      // TF-IDF in their client's stderr. recordError (in providers.ts) already
      // captures every failure into get_stats.recentErrors; this adds the
      // visible-by-default signal the review asked for. Fired before the
      // circuit-breaker count so it surfaces on the very first failure.
      if (!vectorDownWarned) {
        vectorDownWarned = true;
        const url = loadConfig().embeddingUrl || 'http://127.0.0.1:11434/api/embeddings';
        console.error(
          `[total-recall] external embedding provider "${provider}" failed at ${url} — ` +
          `hybrid search is falling back to TF-IDF (vector search degraded for this session). ` +
          `Check the provider is running and reachable; see get_stats for details.`
        );
      }
      consecutiveFailures++;
      if (consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD && !circuitOpenUntil) {
        circuitOpenUntil = Date.now() + CIRCUIT_OPEN_COOLDOWN_MS;
        recordError(
          `Ollama circuit open after ${consecutiveFailures} consecutive embed failures — ` +
          `hybrid recall falling back to TF-IDF for ${CIRCUIT_OPEN_COOLDOWN_MS / 1000}s ` +
          `(check ${provider} at ${loadConfig().embeddingUrl || 'http://127.0.0.1:11434/api/embeddings'})`
        );
      }
    }
  }
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

// Session-scoped circuit breaker for external embed providers (REVIEW 1.2).
// After CIRCUIT_OPEN_THRESHOLD consecutive failures, short-circuit embed() to
// null for CIRCUIT_OPEN_COOLDOWN_MS WITHOUT calling the (likely hung) provider
// — otherwise a down Ollama stalls every hybrid recall for ~2× the per-attempt
// timeout before each one falls back to TF-IDF. The circuit closes again on a
// successful embed (resets the failure count). Exactly one recordError fires
// when the circuit OPENS (the closed→open transition); short-circuited calls
// during the cooldown are silent. HuggingFace is exempt — its failure mode is
// load-time (missing dep), not a per-call hung endpoint, and the pipeline latch
// already covers it.
const CIRCUIT_OPEN_THRESHOLD = 3;
const CIRCUIT_OPEN_COOLDOWN_MS = 60_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0; // epoch ms; 0 = closed

// Proactive vector-down signal (REVIEW 1.3). Every external embed failure is
// recorded into get_stats.recentErrors via recordError (in providers.ts), but
// that sink is only visible if the user calls get_stats — so a user who never
// does sees hybrid search silently become TF-IDF and never learns why. This
// latch emits ONE stderr warning at the start of each down-episode (the first
// failure after a success, or the first failure of the session), so the
// degradation is visible in the client's stderr/log without polling get_stats.
// Reset on a successful embed so a recovery-then-refailure warns again (one
// stderr line per down-episode, not once-per-session — the intent of the
// review is "stop being silent", and a fresh outage deserves a fresh line).
// HuggingFace is exempt for the same reason as the circuit breaker.
let vectorDownWarned = false;

// REVIEW 1.6: a separate latch for the slow-but-reachable case. A timeout is
// not a "down" episode (vectorDownWarned covers that), so it gets its own
// one-line-per-episode hint naming embeddingTimeoutMs — the actionable knob
// for a bge-m3-on-CPU deploy. Reset on success for the same reason as
// vectorDownWarned: a fresh slow-episode deserves a fresh line.
let timeoutWarned = false;

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
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  vectorDownWarned = false;
  timeoutWarned = false;
  // Also clear the test-embedder seam: a prior test that called
  // __testSetEmbedder(null) (e.g. the HuggingFace "model unavailable" case)
  // leaves testEmbedder=null, which makes getEmbedder() return null for EVERY
  // later test — embed() then bails before calling the provider, so no fetch,
  // no hint, no circuit. Resetting here keeps tests isolated by file order.
  testEmbedder = undefined;
}
