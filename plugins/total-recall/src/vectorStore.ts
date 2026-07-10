/**
 * Optional sqlite-vec vector store — lazy-loaded.
 * Gracefully degrades to no-op if sqlite-vec not installed.
 */

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
      // sqlite-vec defaults to L2/Euclidean distance. Our embeddings are normalized
      // (L2 = 1) and we want cosine similarity in [0, 1], so force the table to use
      // cosine distance. An existing table created before this fix will still say
      // FLOAT[384] with no metric; detect that and recreate so scores are comparable
      // to cosine distance instead of raw L2.
      const existing = d.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_memories'"
      ).get() as { sql: string } | undefined;
      const needsRecreate = existing && !/distance_metric\s*=\s*cosine/i.test(existing.sql);
      if (needsRecreate) {
        d.exec("DROP TABLE vec_memories");
      }
      d.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories
        USING vec0(key TEXT PRIMARY KEY, embedding FLOAT[384] distance_metric=cosine);
      `);
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

export async function upsertVector(dbPath: string, key: string, embedding: number[]): Promise<void> {
  const d = await getDb(dbPath);
  if (!d) return;
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
  d.prepare(`DELETE FROM vec_memories WHERE key = ?`).run(key);
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
  const rows = d.prepare(`SELECT key FROM vec_memories`).all() as Array<{ key: string }>;
  return rows.map(r => r.key);
}
