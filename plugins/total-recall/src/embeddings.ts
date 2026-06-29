/**
 * Optional HuggingFace embedding model — lazy-loaded from vector/node_modules.
 * If @huggingface/transformers is not installed, all methods are no-ops.
 */
import { VECTORS_DB } from './paths.js';
import { upsertVector } from './vectorStore.js';

let pipeline: ((text: string) => Promise<number[]>) | null = null;
let loadAttempted = false;

async function getEmbedder(): Promise<((text: string) => Promise<number[]>) | null> {
  if (loadAttempted) return pipeline;
  loadAttempted = true;
  try {
    const { pipeline: hfPipeline } = await import('@huggingface/transformers');
    const extractor = await hfPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    pipeline = async (text: string) => {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data as Float32Array);
    };
  } catch {
    pipeline = null;
  }
  return pipeline;
}

export async function embed(text: string): Promise<number[] | null> {
  const embedder = await getEmbedder();
  if (!embedder) return null;
  return embedder(text);
}

// Fire-and-forget embed → upsert. Centralized so the two write paths (store +
// update) share one implementation, and so the lazy load, the no-op-when-deps-
// absent path, and the null-skip when the model returns nothing are owned
// in one place. The `.catch(() => {})` matches the original inline sites:
// a transient embed or upsert failure is logged via the upsertVector path
// (vectorStore.ts) and never blocks the caller's response.
export function embedAndUpsert(key: string, text: string): void {
  embed(text).then(vec => {
    if (vec) upsertVector(VECTORS_DB, key, vec);
  }).catch(() => {});
}

// Honest signal: true only once the pipeline has actually loaded. Used for
// reporting (get_stats) so a fresh session with no optional deps installed does
// not falsely advertise vector search as enabled. The recall hybrid gate does not
// consult this — it always attempts embed() when hybrid is requested and degrades
// to TF-IDF via the embed()->null path, which is what triggers the lazy load.
export function isVectorAvailable(): boolean {
  return pipeline !== null;
}
