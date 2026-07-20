/**
 * Optional sqlite-vec vector store — lazy-loaded.
 * Gracefully degrades to no-op if sqlite-vec not installed.
 */

import { recordError } from './state.js';

let dbPromise: Promise<any> | null = null;
let cachedDbPath: string | null = null;

async function getDb(dbPath: string): Promise<any> {
  if (cachedDbPath !== null && cachedDbPath !== dbPath) {
    throw new Error(`vectorStore already initialized with ${cachedDbPath}, cannot switch to ${dbPath}`);
  }
  // Cache the *promise*, not the resolved db. The previous code set a `loadAttempted`
  // boolean synchronously before the dynamic import resolved, so a concurrent upsert
  // arriving mid-import saw a transient null db and silently dropped its write.
  // Awaiting one shared promise means every concurrent caller gets the same outcome.
  if (dbPromise) return dbPromise;
  cachedDbPath = dbPath;
  dbPromise = (async () => {
    try {
      const sqliteVec = await import('sqlite-vec');
      const Database = (await import('better-sqlite3')).default;
      const d = new Database(dbPath);
      sqliteVec.load(d);
      return d;
    } catch {
      // Only cache successful loads; a transient failure (missing optional dep,
      // sqlite I/O error) should not permanently disable vector search until restart.
      dbPromise = null;
      cachedDbPath = null;
      return null;
    }
  })();
  return dbPromise;
}

function parseExistingDimension(sql: string): number | null {
  const match = sql.match(/embedding\s+FLOAT\[(\d+)\]/i);
  return match ? parseInt(match[1] as string, 10) : null;
}

// sqlite-vec requires a fixed dimension declared at table creation. The table is
// created lazily on the first upsert/search that provides an embedding length, so
// the dimension is driven by the incoming vectors rather than hardcoded to 384.
// If an existing table was created with a different dimension or without the cosine
// metric (pre-fix tables), drop and recreate it so scores stay comparable.
//
// The DROP-on-mismatch is correct on the WRITE path (upsertVector): the new
// vectors use the new dim, so recreating is the right move. It is destructive
// on the READ path (searchVector): a single recall with a query whose dim
// differs from the stored table (e.g. the user switched embedding model) would
// wipe every stored vector. REVIEW 1.5 splits the two: ensureVecTableForRead
// creates-if-missing but never drops on a dim mismatch — it returns false so
// the caller can recordError + return [] instead of nuking the index.
function ensureVecTable(d: any, dim: number): void {
  const existing = d.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_memories'"
  ).get() as { sql: string } | undefined;
  if (existing) {
    const existingDim = parseExistingDimension(existing.sql);
    const hasCosine = /distance_metric\s*=\s*cosine/i.test(existing.sql);
    if (existingDim === dim && hasCosine) return;
    d.exec("DROP TABLE vec_memories");
  }
  d.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories ` +
    `USING vec0(key TEXT PRIMARY KEY, embedding FLOAT[${dim}] distance_metric=cosine);`
  );
}

// Read-path variant: create the table if it doesn't exist yet (so the MATCH
// query doesn't throw `no such table`), but NEVER drop an existing table whose
// dim differs from the query. Returns true when the table is usable for this
// query dim, false on a dim mismatch (caller bails to [] + recordError).
function ensureVecTableForRead(d: any, dim: number): boolean {
  const existing = d.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_memories'"
  ).get() as { sql: string } | undefined;
  if (existing) {
    const existingDim = parseExistingDimension(existing.sql);
    const hasCosine = /distance_metric\s*=\s*cosine/i.test(existing.sql);
    if (existingDim !== null && (existingDim !== dim || !hasCosine)) return false;
    return true;
  }
  d.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories ` +
    `USING vec0(key TEXT PRIMARY KEY, embedding FLOAT[${dim}] distance_metric=cosine);`
  );
  return true;
}

export async function upsertVector(dbPath: string, key: string, embedding: number[]): Promise<void> {
  const d = await getDb(dbPath);
  if (!d) return;
  if (!Array.isArray(embedding) || embedding.length === 0) return;
  ensureVecTable(d, embedding.length);
  d.prepare(`INSERT OR REPLACE INTO vec_memories(key, embedding) VALUES (?, ?)`).run(
    key,
    JSON.stringify(embedding)
  );
}

export async function searchVector(
  dbPath: string,
  queryEmbedding: number[],
  limit = 20
): Promise<Array<{ key: string; score: number }>> {
  const d = await getDb(dbPath);
  if (!d) return [];
  // Read path: never DROP the stored table on a dim mismatch (REVIEW 1.5). A
  // mismatch means the embedding model changed since the vectors were stored —
  // surface it via recordError and return [] so recall degrades to TF-IDF; the
  // next upsertVector (write path) or an explicit rebuild_index recreates the
  // table with the new dim. Dropping here would wipe every stored vector off a
  // single recall attempt.
  if (!ensureVecTableForRead(d, queryEmbedding.length)) {
    recordError(
      `vector search skipped: query embedding dim ${queryEmbedding.length} != stored vec_memories dim ` +
      `(embedding model changed? run rebuild_index to re-embed with the new model)`
    );
    return [];
  }
  const rows = d
    .prepare(
      `SELECT key, distance FROM vec_memories
       WHERE embedding MATCH ?
       ORDER BY distance LIMIT ?`
    )
    .all(JSON.stringify(queryEmbedding), limit);
  return rows.map((r: any) => ({ key: r.key, score: 1 - r.distance }));
}

export async function deleteVector(dbPath: string, key: string): Promise<void> {
  const d = await getDb(dbPath);
  if (!d) return;
  try {
    d.prepare(`DELETE FROM vec_memories WHERE key = ?`).run(key);
  } catch (e: any) {
    // A freshly-created db with no vectors yet has no vec_memories table.
    // Treat a missing table as a no-op delete, not a fatal error.
    if (e && typeof e.message === 'string' && /no such table/i.test(e.message)) return;
    throw e;
  }
}

// All keys currently present in the vector store. Returns null when the optional
// sqlite-vec deps are absent (getDb resolves to null) — callers treat null as
// "no vector store, skip vector work" rather than "empty store". Used by
// reconcileIndex's boot backfill (vault-scan.ts) to find memIndex keys that
// have a .md file but no vec_memories row — left by a prior SIGTERM that killed
// a fire-and-forget embedAndUpsert before it landed (#3).
export async function listVectorKeys(dbPath: string): Promise<string[] | null> {
  const d = await getDb(dbPath);
  if (!d) return null;
  try {
    const rows = d.prepare(`SELECT key FROM vec_memories`).all() as Array<{ key: string }>;
    return rows.map(r => r.key);
  } catch (e: any) {
    // A freshly-created db may not have the vec table yet if no upsert/search
    // has run. Treat a missing table as an empty store, not a fatal error.
    if (e && typeof e.message === 'string' && /no such table/i.test(e.message)) return [];
    throw e;
  }
}
