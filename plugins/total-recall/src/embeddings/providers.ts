// External embedding-provider registry (REVIEW 9.1).
//
// embeddings.ts used to branch on `if (provider === 'ollama')` inline; adding a
// second external provider (OpenAI, Cohere, a second Ollama model with a
// different transport) meant editing that if/else in three places (getEmbedder,
// getExternalEmbedding, isVectorAvailable). The registry moves the per-provider
// transport into one object per provider; adding a provider = adding one entry
// to PROVIDERS below, no orchestration code to touch.
//
// Scope: this file holds the STATELESS, per-call external providers (HTTP/RPC
// embed endpoints). HuggingFace is NOT here — it lazy-loads a model once into a
// cached pipeline and is handled in embeddings.ts via the in-flight-promise
// cache. The cross-provider orchestration (lazy-load caching, the
// externalEmbedSuccess availability latch, the test seam, embedAndUpsert) stays
// in embeddings.ts; each provider here only owns its own transport, timeout,
// and retry.

import { recordError } from '../state.js';

// The config slice a provider reads. Intentionally a structural subset of
// TotalRecallConfig (paths.ts) so loadConfig() passes straight through; a
// provider reads only its own keys off `config`. The `embeddingProvider` field
// is widened to `string` here so the registry lookup accepts any name (an
// unknown name still resolves to undefined → clean TF-IDF fallback), not just
// the two enumerated in TotalRecallConfig.
export interface EmbeddingConfig {
  embeddingProvider?: string;
  embeddingUrl?: string;
  embeddingModel?: string;
  embeddingTimeoutMs?: number;
}

// One external embedding provider. `embed` is called per embed() (external
// providers are stateless — no model to load or cache); it returns the vector
// or null on failure and records its own errors via recordError. The
// availability latch (externalEmbedSuccess) is managed by embeddings.ts's
// embed() wrapper based on whether this returns a vector, so a provider does
// NOT touch the latch — keeping "reset on failure" (REVIEW 1.4) centralized and
// uniform across every provider.
export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string, config: EmbeddingConfig): Promise<number[] | null>;
}

// A reachable-but-slow endpoint: the AbortController fired (REVIEW 1.6) before
// the embed returned — the model is healthy but took longer than
// embeddingTimeoutMs (e.g. bge-m3 cold inference ~12s on CPU vs a 5s default).
// This is a DIFFERENT failure class from "Ollama is down" (connection refused /
// HTTP 500): the daemon answered, it was just slow. embeddings.ts's embed()
// catches it to skip the session circuit breaker (a slow success must not
// force-disable vectors for 60s on a working daemon) and emit a targeted hint
// naming embeddingTimeoutMs, rather than the generic "provider failed" warning
// that misleads users into thinking Ollama is down.
export class EmbedTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`embedding timed out after ${timeoutMs}ms`);
    this.name = 'EmbedTimeoutError';
    this.timeoutMs = timeoutMs;
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

const ollamaProvider: EmbeddingProvider = {
  name: 'ollama',
  async embed(text, config) {
    const url = config.embeddingUrl || 'http://127.0.0.1:11434/api/embeddings';
    const model = config.embeddingModel || 'bge-m3';
    // REVIEW 1.6: raised from 5000 to 15000. The previous 5s default (set in
    // REVIEW 1.2 to cap a hung Ollama at ~10.2s read latency) is BELOW the
    // cold-inference time of the model install.sh --complete AUTO-SELECTS when
    // it's available — bge-m3, ~12s on a CPU-only laptop — so the plugin's own
    // recommended config silently kept vectorSearchEnabled=false on every
    // CPU machine (every embed aborted at 5s, the availability latch never
    // flipped). 15s covers bge-m3 cold while the session circuit breaker in
    // embeddings.ts (REVIEW 1.2, 3 fails → 60s cooldown) still caps the
    // genuinely-hung case: worst-case read latency is now 2×15s+200ms ≈ 30s
    // before TF-IDF fallback, then 60s cooldown on a truly dead daemon. A
    // timeout no longer counts toward that breaker (see EmbedTimeoutError) —
    // a slow success is not "down". Override per-deploy via embeddingTimeoutMs.
    const timeoutMs = config.embeddingTimeoutMs ?? 15000;
    try {
      return await ollamaEmbedAttempt(url, model, text, timeoutMs);
    } catch (firstErr) {
      // Don't retry a timeout: a slow model will be just as slow 200ms later,
      // and retrying would double the wait (2×timeoutMs) before giving up.
      // Only retry the transient "Ollama busy loading/evicting another model"
      // HTTP 500 / network-blip class, which resolves in a few hundred ms.
      if (firstErr && (firstErr as Error).name === 'AbortError') {
        throw new EmbedTimeoutError(timeoutMs);
      }
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
        if (e && (e as Error).name === 'AbortError') {
          throw new EmbedTimeoutError(timeoutMs);
        }
        recordError(`Ollama embedding failed after retry: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }
  },
};

// Registry of external embedding providers. Looked up by `config.embeddingProvider`
// (case-sensitive). An unknown name resolves to undefined → embeddings.ts
// returns no embedder → embed() returns null and isVectorAvailable() stays
// false, with no transport call attempted (so a typo or an as-yet-unimplemented
// provider degrades cleanly to TF-IDF rather than firing a stray fetch).
// Adding a provider = adding one entry here.
export const PROVIDERS: Record<string, EmbeddingProvider> = {
  ollama: ollamaProvider,
};