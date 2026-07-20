/**
 * Optional sqlite-vec vector store — lazy-loaded.
 * Gracefully degrades to no-op if sqlite-vec not installed.
 */

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { recordError } from './state.js';

let dbPromise: Promise<any> | null = null;
let cachedDbPath: string | null = null;

// ─── Native-binding self-heal ─────────────────────────────────────────────────
//
// Each plugin-cache version dir (~/.claude/plugins/cache/.../<VERSION>/) ships
// its OWN node_modules/better-sqlite3 — as source (binding.gyp + deps/ + src/,
// no prebuilds/). Its install script `prebuild-install || node-gyp rebuild
// --release` must run to produce build/Release/better_sqlite3.node. install.sh
// runs that on first install, but `claude plugin update` creates a fresh
// version dir and does NOT re-run install.sh; if better-sqlite3's own install
// script failed there (transient prebuild-download error, or no build tools
// for the node-gyp fallback), the dir is left source-only and `new Database()`
// throws ("Could not locate binding file build/Release/better_sqlite3.node").
// Vector search then silently stays off until someone hand-runs the rebuild.
//
// Self-heal: on the FIRST load failure, run `npm rebuild better-sqlite3` in the
// plugin dir (re-runs prebuild-install || node-gyp rebuild — the exact install.sh
// path) and retry the import once. Latched per-process so a persistent failure
// (no build tools, offline) blocks for one timeout, not on every recall.
// sqlite-vec is pure JS (no native binding), so only better-sqlite3 needs this.
let rebuildAttempted = false;

type RebuildResult = { attempted: boolean; ok: boolean; detail?: string };

// Resolve the plugin root (where node_modules/better-sqlite3 lives). Under the
// esbuild ESM bundle, import.meta.url is the bundle file (dist/index.js); under
// tsx/dev it is the source file (src/vectorStore.ts). In both cases the parent
// of its directory is the plugin root. Returns null when better-sqlite3 isn't
// installed under that root (optional-dep-absent → nothing to rebuild).
function pluginRootForRebuild(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, '..');
    return existsSync(path.join(root, 'node_modules', 'better-sqlite3')) ? root : null;
  } catch {
    return null;
  }
}

// Locate npm's CLI entry without relying on PATH. nvm / standard Node installs
// place it at <nodeDir>/../lib/node_modules/npm/bin/npm-cli.js. Spawning
// `process.execPath <npm-cli.js> rebuild ...` avoids the shell and the `npm`
// bin shim, so it works even when the MCP process inherited a stripped PATH.
function resolveNpmCli(): string | null {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

async function rebuildNativeBindings(): Promise<RebuildResult> {
  const root = pluginRootForRebuild();
  if (!root) return { attempted: false, ok: false }; // nothing to rebuild
  const npmCli = resolveNpmCli();
  const tail = (s: string | Buffer | undefined) =>
    typeof s === 'string' ? s.slice(-500) : '';
  try {
    const result = npmCli
      ? spawnSync(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'], {
          cwd: root, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawnSync('npm', ['rebuild', 'better-sqlite3'], {
          cwd: root, encoding: 'utf8', timeout: 180000, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
    if (result.error || result.status !== 0) {
      return {
        attempted: true,
        ok: false,
        detail: `exit ${result.status ?? 'n/a'}: ${result.error ? result.error.message : tail(result.stderr)}`.trim(),
      };
    }
    return { attempted: true, ok: true };
  } catch (e: any) {
    return { attempted: true, ok: false, detail: `threw: ${e?.message ?? String(e)}` };
  }
}

// Test seam (mirrors __testsSetEmbedder in embeddings.ts). The default impl is
// a no-op under NODE_ENV=test so existing degrade tests stay silent (no spawn,
// no recordError); self-heal tests inject a fake to exercise the retry/latch.
let __rebuildImpl: () => Promise<RebuildResult> = async () => {
  if (process.env.NODE_ENV === 'test') return { attempted: false, ok: false };
  return rebuildNativeBindings();
};
export function __testsSetRebuildImpl(fn: () => Promise<RebuildResult>): void {
  if (process.env.NODE_ENV === 'test') __rebuildImpl = fn;
}
// Test-only handle to drive getDb directly without going through upsert/search.
export async function __testsGetDb(dbPath: string): Promise<any> {
  return getDb(dbPath);
}

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
    } catch (loadErr: any) {
      // Self-heal: a fresh plugin-cache dir (from `claude plugin update`) can
      // ship better-sqlite3 source-only — its install script didn't produce
      // build/Release/better_sqlite3.node. install.sh doesn't re-run on update,
      // so attempt one in-process `npm rebuild better-sqlite3` before degrading.
      // Latched per-process so a persistent failure blocks once, not per recall.
      //
      // CAVEAT: `npm rebuild better-sqlite3` can exit 0 ("rebuilt dependencies
      // successfully") WITHOUT producing the binding — its install script is
      // `prebuild-install || node-gyp rebuild --release`, and prebuild-install
      // fails offline (ECONNREFUSED to the GitHub releases host) while node-gyp
      // is often not installed, so the source-compile fallback can't run. npm
      // treats the failed install script as non-fatal and still exits 0. So the
      // load RETRY below is the ground truth — never claim success from npm's
      // exit code alone. When the retry still fails, record an honest, actionable
      // error (not "succeeded") so the user knows to run the rebuild manually.
      if (!rebuildAttempted) {
        rebuildAttempted = true;
        const r = await __rebuildImpl();
        if (r.attempted) {
          try {
            const sqliteVec = await import('sqlite-vec');
            const Database = (await import('better-sqlite3')).default;
            const d = new Database(dbPath);
            sqliteVec.load(d);
            return d;
          } catch (retryErr: any) {
            const outcome = r.ok
              ? `npm rebuild reported success (exit 0) but the binding is still absent ` +
                `(prebuild-install likely failed to download — offline or no matching prebuild ` +
                `for this Node ABI — and node-gyp is not installed to compile from source)`
              : `npm rebuild failed (${r.detail ?? 'non-zero exit'})`;
            recordError(
              `vectorStore: better-sqlite3 native binding missing and in-process rebuild did ` +
              `not restore it (${outcome}; original load error: ${loadErr?.message ?? loadErr}; ` +
              `retry load error: ${retryErr?.message ?? retryErr}). Run 'npm rebuild better-sqlite3' ` +
              `in the plugin dir to restore vector search. TF-IDF search still works.`
            );
          }
        }
        // r.attempted === false (test default, or no node_modules/better-sqlite3
        // found): silent degrade — preserves the pre-self-heal optional-dep-absent
        // behavior, no recordError.
      }
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

// Batch-read stored vectors by key (REVIEW 1.6). rerank_memories previously
// re-embedded every candidate on every call even though embedAndUpsert already
// wrote its vector to vec_memories on store/update — up to MAX_KEYS fresh
// embed() calls per rerank, repeated identically on the next call with the
// same candidates. vec_to_json() converts sqlite-vec's internal BLOB encoding
// back to a JSON array string; keys with no stored vector (not yet embedded,
// or vector deps absent) are simply absent from the returned map, and the
// caller falls back to embed() only for those.
export async function getVectors(dbPath: string, keys: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (keys.length === 0) return result;
  const d = await getDb(dbPath);
  if (!d) return result;
  try {
    const placeholders = keys.map(() => '?').join(',');
    const rows = d
      .prepare(`SELECT key, vec_to_json(embedding) AS embedding FROM vec_memories WHERE key IN (${placeholders})`)
      .all(...keys) as Array<{ key: string; embedding: string }>;
    for (const r of rows) {
      result.set(r.key, JSON.parse(r.embedding));
    }
  } catch (e: any) {
    // A freshly-created db with no vectors yet has no vec_memories table.
    if (e && typeof e.message === 'string' && /no such table/i.test(e.message)) return result;
    throw e;
  }
  return result;
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
