import * as fs from 'fs';
import * as os from 'os';
import { parseFrontmatter, stringifyFrontmatter, withExecutiveSummary } from '../frontmatter.js';
import { clampImportanceScore } from '../ebbinghaus.js';
import { VECTORS_DB, NO_PRUNE_TAG } from '../paths.js';
import { reconcileIndex, assertRegularFile, tokenEstimate, isReservedKey, readCachedOrFresh } from '../vault-scan.js';
import { rebuildInvertedIndex, registerDocument, deregisterDocument } from '../tfidf.js';
import { memIndex, recordError } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { scheduleSave } from '../persistence.js';
import { embedAndUpsert, embed, embedTextFor, flushEmbeddings } from '../embeddings.js';
import { deleteVector, dropVectorTable, upsertVector } from '../vectorStore.js';
import type { MemoryFrontmatter } from '../types.js';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapHandler } from './registry.js';

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t: unknown) => (t === null || t === undefined ? '' : typeof t === 'string' ? t : String(t)))
    .filter(Boolean);
}

export function updateMemory(args: any): any {
  const { key, content, tags, importanceScore } = args;
  const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined;
  if (typeof key !== 'string' || isReservedKey(key)) {
    throw new Error(`Invalid key "${key}": reserved key segment or not a string.`);
  }
  const meta = memIndex[key];
  if (!meta) throw new Error(`Memory not found: ${key}`);

  // Symlink containment (mirrors store.ts:122-136): meta.filePath is re-derived
  // from the validated key (Pass 1), so it's lexically inside the vault — but the
  // entry at that path can still be a symlink a teammate planted via the org
  // vault's `git pull` (the org vault is shared; `git pull` preserves symlinks).
  // assertRegularFile lstats the entry itself (a symlink reports isFile()=false →
  // throws the same "not a regular file" error the inlined guard threw), so the
  // readFileSync + writeFileSync below never follow a planted link and clobber its
  // target — the write-escape Pass 1 closed for store_memory, missed here until
  // Pass 5. ENOENT (file removed since load) is let through to readFileSync, which
  // throws a clear error. See assertRegularFile in vault-scan.ts.
  assertRegularFile(meta.filePath, key);

  const raw = fs.readFileSync(meta.filePath, 'utf8');
  const parsed = parseFrontmatter(raw);
  const now = new Date().toISOString();

  // Org memories are author-protected, mirroring store_memory's guard.
  // Fail-closed: a missing author on an existing org memory is treated as
  // foreign (not silently overwritable), so a caller can't bypass the guard on
  // a legacy/untagged file. Matches store_memory's `existingFm.author !==
  // effectiveAuthor` check.
  if (meta.isOrg) {
    const existingAuthor = (parsed.data as Partial<MemoryFrontmatter>).author;
    if (existingAuthor !== os.userInfo().username) {
      throw new Error(`Cannot update org memory authored by ${existingAuthor ?? '(unknown)'}.`);
    }
  }

  const prevSessions = Array.isArray(parsed.data.sessions) ? parsed.data.sessions : [];
  const sessions = [...new Set([...prevSessions, ...(sessionId ? [sessionId] : [])])].slice(-50);

  const newFm = {
    ...parsed.data,
    // Coerce to defaults (matching indexFile) so an update that omits the arg
    // against a file that never had the field can't leave tags/importanceScore as
    // `undefined` in memIndex — that would crash tfidfSearch/list filters (~3s
    // later via the debounced rebuildInvertedIndex) on meta.tags.join/.includes.
    // Coerce tags to an array: the existing file may carry a scalar `tags` from a
    // hand-edited/teammate-pushed frontmatter; matches indexFile's Array.isArray
    // guard, without which a scalar would crash tfidfSearch's meta.tags.join and
    // getRelatedMemories' Set(m.tags).
    //
    // T3 (option b — lenient): a caller-supplied SCALAR `tags` (non-array) is
    // IGNORED and the existing tags are kept, NOT used to wipe the field to [].
    // The MCP schema (server.ts) declares `tags` as `array`, so a well-behaved
    // client never sends a scalar; but a direct caller or malformed request can,
    // and the pre-fix code (`Array.isArray(tags ?? parsed.data.tags) ? ... : []`)
    // wiped the whole tags field on a scalar — silent data loss on an update that
    // meant to leave tags alone (e.g. only changing `content`). Strict (throw)
    // would match the schema but break a caller that passed a scalar by mistake;
    // lenient preserves the user's existing tags. So: array → use it; undefined
    // OR scalar → keep existing (coerced to [] if the existing value is itself a
    // scalar, same as indexFile).
    tags: normalizeTags(Array.isArray(tags) ? tags : (Array.isArray(parsed.data.tags) ? parsed.data.tags : [])),
    // Clamp to a finite [0, 1] number — see clampImportanceScore in ebbinghaus.ts.
    importanceScore: clampImportanceScore(importanceScore ?? parsed.data.importanceScore),
    updated: now,
    sessions,
  };

  // When new content is supplied, normalize it to begin with the Executive Summary
  // header (idempotent), matching what store_memory writes and what parseFrontmatter
  // yields on the read path — so contentPreview stays consistent with disk.
  // Use `content !== undefined` so an explicit empty string (`content: ''`) is a
  // legitimate "clear the body" update, not "leave the old content unchanged".
  // Coerce to string: a non-string value (number, null, undefined) would otherwise
  // throw inside withExecutiveSummary.
  const newContent = content !== undefined ? withExecutiveSummary(String(content)) : parsed.content;
  const fileContent = stringifyFrontmatter(newContent, newFm);
  fs.writeFileSync(meta.filePath, fileContent);

  // #19: recapture the just-written file's stat (mirrors store.ts). Without it,
  // meta keeps the pre-update mtimeMs/size, so the next reconcileIndex sees a
  // mismatch and pays a redundant re-read — and, worse, tokenEstimate stays
  // stale in list_memories/search_index until that reconcile. Best-effort: a
  // throw leaves 0/0, which just forces the re-read.
  let mtimeMs = 0, size = 0;
  try { const st = fs.statSync(meta.filePath); mtimeMs = st.mtimeMs; size = st.size; } catch { /* best-effort */ }
  Object.assign(meta, {
    tags: newFm.tags,
    importanceScore: newFm.importanceScore,
    updated: now,
    sessions: newFm.sessions,
    contentPreview: newContent.trim().slice(0, 500),
    tokenEstimate: tokenEstimate(fileContent),
    mtimeMs, size,
  });

  contentCache.delete(key);
  registerDocument(key, meta.title, meta.tags, meta.contentPreview);
  scheduleSave();

  // 3.11: re-embed only when content changes. The embedded text is
  // `embedTextFor(title, body)` (embeddings.ts 3.3) — the TITLE and the BODY, NOT
  // the tags or importanceScore. A tag-only or importance-only update changes
  // nothing in the text the vector is built from, so the old vector is still the
  // correct vector for the memory; re-embedding on a tag change was a bug — it
  // paid an embed() to produce the identical vector. (Tags/importance still
  // affect TF-IDF search and pruning via their own indexes, updated above.)
  // `content !== undefined` (not truthy) so an explicit empty-string body — a
  // clear-the-body update — still re-embeds and replaces the wiped content's
  // vector (the regression pinned by the "explicit empty-string content" test).
  if (content !== undefined) embedAndUpsert(key, newContent);

  return { key, message: 'Memory updated.' };
}

export function deleteMemory(args: any): any {
  const { key, force = false } = args;
  if (typeof key !== 'string' || isReservedKey(key)) {
    throw new Error(`Invalid key "${key}": reserved key segment or not a string.`);
  }
  const meta = memIndex[key];
  if (!meta) throw new Error(`Memory not found: ${key}`);

  // Org memories are author-protected, mirroring store_memory's guard.
  // Fail-closed: a missing author on an existing org memory is treated as
  // foreign (not silently deletable). force=true overrides the no-prune guard
  // below, but it does NOT override authorship — a deliberate teardown must be
  // performed by the original author (or after the author field is corrected).
  if (meta.isOrg) {
    try {
      assertRegularFile(meta.filePath, key);
      const raw = fs.readFileSync(meta.filePath, 'utf8');
      const parsed = parseFrontmatter(raw);
      const existingAuthor = (parsed.data as Partial<MemoryFrontmatter>).author;
      if (existingAuthor !== os.userInfo().username) {
        throw new Error(`Cannot delete org memory authored by ${existingAuthor ?? '(unknown)'}.`);
      }
    } catch (e: any) {
      // ENOENT (file already removed) is the normal repeated-delete case; allow
      // the in-memory cleanup to proceed. Any other failure (symlink, parse error,
      // author mismatch) is fail-closed.
      if (!e || e.code !== 'ENOENT') throw e;
    }
  }

  // Immortal-memory guard (mirrors store_memory's `force` pattern at store.ts).
  // A `no-prune`-tagged memory (e.g. an ADR) is refused even for the org author —
  // no-prune is orthogonal to authorship, it marks decisions that must not
  // disappear. An explicit `force=true` overrides, so a deliberate teardown is
  // still possible. See NO_PRUNE_TAG in paths.ts.
  if (meta.tags.includes(NO_PRUNE_TAG) && !force) {
    throw new Error(
      `Memory "${key}" is tagged '${NO_PRUNE_TAG}' and cannot be deleted. ` +
      `Pass force=true to override.`
    );
  }

  // If the file was already removed (a repeated delete, or an external removal
  // since the index was loaded), unlinkSync would throw and abort the in-memory
  // cleanup. Swallow the fs error and still drop the index/vector/cache entries so
  // the key is gone regardless of on-disk state.
  try { fs.unlinkSync(meta.filePath); } catch {}
  delete memIndex[key];
  deregisterDocument(key);
  contentCache.delete(key);
  deleteVector(VECTORS_DB, key).catch(() => {});
  scheduleSave();

  return { key, message: 'Memory deleted.' };
}

export function confirmMemory(args: any): any {
  const { key } = args;
  // The schema declares `useful` as a boolean (server.ts), so an explicit
  // boolean false is the only flag signal. Do not silently coerce a stray
  // string `"false"` — that hides a client/schema bug; let it surface as a
  // confirmation instead. REVIEW 3.3.
  const useful = args.useful !== false;
  if (typeof key !== 'string' || isReservedKey(key)) {
    throw new Error(`Invalid key "${key}": reserved key segment or not a string.`);
  }
  const meta = memIndex[key];
  if (!meta) throw new Error(`Memory not found: ${key}`);

  assertRegularFile(meta.filePath, key);

  const raw = fs.readFileSync(meta.filePath, 'utf8');
  const parsed = parseFrontmatter(raw);

  // Org memories are author-protected on confirmation too: a teammate should not
  // be able to manipulate another author's Ebbinghaus retention signal.
  if (meta.isOrg) {
    const existingAuthor = (parsed.data as Partial<MemoryFrontmatter>).author;
    if (existingAuthor !== os.userInfo().username) {
      throw new Error(`Cannot confirm org memory authored by ${existingAuthor ?? '(unknown)'}.`);
    }
  }

  const field = useful === false ? 'flags' : 'confirmations';
  const prev = Number.isFinite(parsed.data[field]) ? Math.max(0, Number(parsed.data[field])) : 0;
  const next = prev + 1;
  const now = new Date().toISOString();

  const newFm = { ...parsed.data, [field]: next, updated: now };
  const fileContent = stringifyFrontmatter(parsed.content, newFm);
  fs.writeFileSync(meta.filePath, fileContent);

  Object.assign(meta, { [field]: next, updated: now });
  contentCache.delete(key);
  scheduleSave();

  return {
    key,
    useful,
    [field]: next,
    message: `Memory ${useful === false ? 'flagged' : 'confirmed'}.`,
  };
}

// Opt-in bulk re-embed of every memory in the index at the CURRENT embedding
// model's dimension. `rebuild_index` defaults to cheap (reconcile + inverted
// rebuild only); `forceReembed: true` invokes this. The motivating gap (C-1):
// after an embedding-model switch (e.g. MiniLM 384-d → bge-m3 1024-d) every key
// still HAS a stored vector — at the OLD dim — so `rebuild_index`'s
// `reconcileVectors` backfill (which only fills MISSING keys) is a no-op for
// them, and `searchVector` refuses the mismatched-dim rows (returns [] → recall
// degrades to TF-IDF). Today the only workaround is store/update each memory (or
// manually drop vec_memories). This makes that one-shot bulk re-embed a tool
// flag instead.
//
// Design notes (deliberately NOT a bare "drop → reconcileVectors"):
//   • Bounded queue — cap concurrent embed() calls (REEMBED_CONCURRENCY) so a
//     large vault doesn't fan out unbounded inference at once, mirroring
//     rerank's MAX_FRESH_EMBEDS_PER_CALL rationale. reconcileVectors is
//     fire-and-forget with no cap; a dedicated helper owns the bound.
//   • Full content — embed embedTextFor(title, FULL body) via readCachedOrFresh
//     (like rerank), not reconcileVectors' contentPreview. MiniLM truncates past
//     256 tokens so the difference is usually immaterial, but full content is the
//     honest "rebuild at the new model" shape and matches store/update.
//   • Awaited — each upsert is awaited and flushEmbeddings drains at the end, so
//     the tool response's count is truthful (not "scheduled N, landed M").
//   • Refuse-early guard — probe the embedder with the first memory BEFORE
//     dropping the table; if embed() is returning null (deps absent, model load
//     failed), dropping vec_memories would only backfill nothing and leave the
//     index emptied. Record + return without dropping.
const REEMBED_CONCURRENCY = 8;
export async function reembedAll(): Promise<{
  dropped: boolean;
  reembedded: number;
  skipped: number;
}> {
  const keys = Object.keys(memIndex);
  if (keys.length === 0) {
    return { dropped: false, reembedded: 0, skipped: 0 };
  }

  // Probe with the first memory before any destructive drop. embed() returning
  // null means the embedder is unavailable — dropping the table would only
  // backfill nothing. isVectorAvailable() alone is insufficient: it's false until
  // the pipeline first loads, so a fresh-but-healthy process would be wrongly
  // refused. The probe actually exercises the load path.
  const firstKey = keys[0]!;
  const firstMeta = memIndex[firstKey]!;
  const firstBody = readCachedOrFresh(firstKey, firstMeta.filePath, 'reread').content
    || firstMeta.contentPreview || '';
  const probe = await embed(embedTextFor(firstMeta.title, firstBody));
  if (!probe) {
    recordError(
      'reembedAll: embedder unavailable (vector deps absent or model load failed) — ' +
      'vec_memories left untouched, no re-embed performed'
    );
    return { dropped: false, reembedded: 0, skipped: keys.length };
  }

  // Old-dim rows are already unusable after a model switch (searchVector returns
  // [] on a dim mismatch), so dropping them costs zero recall quality. The next
  // upsert recreates the table at the new dim and re-fingerprints vec_meta.
  await dropVectorTable(VECTORS_DB);

  let reembedded = 0;
  // Re-use the probe vector for the first memory so it isn't embedded twice.
  try {
    await upsertVector(VECTORS_DB, firstKey, probe);
    reembedded++;
  } catch (e) {
    recordError(`reembedAll(${firstKey}): ${e instanceof Error ? e.message : String(e)}`);
  }

  // Bounded worker pool over the remaining keys. Each worker pulls the next index
  // off the shared cursor, embeds the full (title + body) text, and awaits the
  // upsert — so the count we return reflects vectors that actually landed.
  let cursor = 1;
  const workerCount = Math.min(REEMBED_CONCURRENCY, keys.length);
  await Promise.all(
    new Array(workerCount).fill(0).map(async () => {
      while (cursor < keys.length) {
        const i = cursor++;
        const key = keys[i]!;
        const meta = memIndex[key];
        if (!meta) continue;
        try {
          const body = readCachedOrFresh(key, meta.filePath, 'reread').content
            || meta.contentPreview || '';
          const vec = await embed(embedTextFor(meta.title, body));
          if (vec) {
            await upsertVector(VECTORS_DB, key, vec);
            reembedded++;
          }
        } catch (e) {
          recordError(`reembedAll(${key}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })
  );

  // Drain any fire-and-forget embeds still in flight from store/update paths so
  // the response count is truthful (reembedAll's own upserts are already awaited;
  // this is belt-and-suspenders for concurrent writers).
  await flushEmbeddings();

  return { dropped: true, reembedded, skipped: keys.length - reembedded };
}

export async function rebuildIndex(args: any = {}): Promise<any> {
  const forceReembed = args?.forceReembed === true;
  // Reconcile against disk: add new/updated files, drop deleted ones, and preserve
  // runtime accessCount/lastAccessed for memories that still exist.
  reconcileIndex();
  rebuildInvertedIndex();
  scheduleSave();

  const count = Object.keys(memIndex).length;
  if (!forceReembed) {
    return { message: `Index rebuilt. ${count} memories indexed.` };
  }

  const r = await reembedAll();
  const total = r.reembedded + r.skipped;
  const tail = r.dropped
    ? ` Re-embedded ${r.reembedded}/${total} memories at the current embedding model (${r.skipped} skipped).`
    : ` Embedder unavailable — vec_memories left untouched, 0/${total} re-embedded.`;
  return {
    message: `Index rebuilt. ${count} memories indexed.${tail}`,
    dropped: r.dropped,
    reembedded: r.reembedded,
    skipped: r.skipped,
  };
}
// ─── Registration (Phase 6.1-6.3: schema co-located with handler) ──────────────
const updateMemorySchema = {
  key: z.string(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  importanceScore: z.number().min(0).max(1).optional(),
  sessionId: z.string().optional(),
};

const deleteMemorySchema = {
  key: z.string(),
  force: z.boolean().default(false).describe('Override the no-prune tag guard (use to delete an immortal memory).'),
};

const confirmMemorySchema = {
  key: z.string(),
  useful: z.boolean().default(true).describe('true = confirmation, false = flag.'),
};

const rebuildIndexSchema = {
  forceReembed: z
    .boolean()
    .default(false)
    .describe(
      'Drop every stored vector and re-embed all memories at the current embedding model\'s dimension (one-shot bulk re-embed, e.g. after switching embedding model). Default false keeps rebuild_index cheap (reconcile + inverted rebuild only). Refuses without dropping if the embedder is unavailable.'
    ),
};

export function register(server: McpServer) {
  server.registerTool(
    'update_memory',
    {
      description: 'Update content, tags, or importanceScore of an existing memory.',
      inputSchema: updateMemorySchema,
    },
    wrapHandler('update_memory', updateMemory),
  );
  server.registerTool(
    'delete_memory',
    {
      description: 'Delete a memory from the vault and index. Refuses memories tagged "no-prune" unless force=true is passed.',
      inputSchema: deleteMemorySchema,
    },
    wrapHandler('delete_memory', deleteMemory),
  );
  server.registerTool(
    'confirm_memory',
    {
      description: 'Confirm or flag a memory. useful=true increments confirmations (reinforces retention); useful=false increments flags (accelerates decay).',
      inputSchema: confirmMemorySchema,
    },
    wrapHandler('confirm_memory', confirmMemory),
  );
  server.registerTool(
    'rebuild_index',
    {
      description: 'Full re-scan of both vaults. Rebuilds inverted index. Pass forceReembed=true to additionally drop and re-embed every memory\'s vector at the current embedding model (one-shot bulk re-embed after a model switch).',
      inputSchema: rebuildIndexSchema,
    },
    wrapHandler('rebuild_index', rebuildIndex),
  );
}
