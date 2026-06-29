import * as fs from 'fs';
import * as os from 'os';
import { parseFrontmatter, stringifyFrontmatter, withExecutiveSummary } from '../frontmatter.js';
import { VECTORS_DB } from '../paths.js';
import { reconcileIndex } from '../vault-scan.js';
import { rebuildInvertedIndex } from '../tfidf.js';
import { memIndex } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { scheduleSave } from '../persistence.js';
import { embed } from '../embeddings.js';
import { upsertVector, deleteVector } from '../vectorStore.js';
import type { MemoryFrontmatter } from '../types.js';

export function updateMemory(args: any): any {
  const { key, content, tags, importanceScore, sessionId } = args;
  const meta = memIndex[key];
  if (!meta) throw new Error(`Memory not found: ${key}`);

  // Symlink containment (mirrors store.ts:122-136): coerceMemEntry re-derives
  // meta.filePath from the validated key (Pass 1), so it's lexically inside the
  // vault — but the filesystem entry at that path can still be a symlink a
  // teammate planted via the org vault's `git pull` (the org vault is a shared
  // repo, and `git pull` preserves symlinks). The lexical path check does NOT
  // detect symlinks, so without this guard readFileSync(meta.filePath) below
  // follows the link and reads the target into `raw`, and writeFileSync
  // (meta.filePath, ...) further down follows it and CLOBBERS the target — the
  // same planted-symlink write-escape Pass 1 closed for store_memory, missed on
  // the parallel update path. lstatSync stats the entry itself (not the target)
  // → a symlink reports isFile()=false and is rejected regardless of what it
  // points at. ENOENT (the file was removed since the index loaded) falls
  // through to the readFileSync, which throws a clear error.
  try {
    if (!fs.lstatSync(meta.filePath).isFile()) {
      throw new Error(`Memory "${key}" is not a regular file (symlink or directory) — refusing to follow a possible planted link in the shared org vault.`);
    }
  } catch (e: any) {
    if (!e || e.code !== 'ENOENT') throw e; // ENOENT = file removed since load, fine
  }

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
    // Coerce tags to an array: a caller may pass a scalar, or the existing file
    // may carry a scalar `tags` from a hand-edited/teammate-pushed frontmatter.
    // Matches indexFile's Array.isArray guard; without it, a scalar would crash
    // tfidfSearch's meta.tags.join and getRelatedMemories' Set(m.tags).
    tags: Array.isArray(tags ?? parsed.data.tags) ? (tags ?? parsed.data.tags) : [],
    // Clamp to [0, 1]: importanceScore drives the Ebbinghaus retention formula
    // and out-of-range values (>1 inflate retention indefinitely, <0 inverts it).
    // MCP does not enforce the inputSchema (see store.ts destructure comment), so a
    // caller-supplied 5 or -1 would otherwise be persisted and distort pruning.
    // The Number.isFinite guard closes the NaN hole: `Math.min(1, NaN)` returns
    // NaN (NaN propagates through Math.min/max), so a non-numeric string like
    // 'high' would persist as NaN. Fall back to 0.5 (the schema default) in that
    // case, matching Ebbinghaus's own fallback.
    importanceScore: Math.max(0, Math.min(1, Number.isFinite(Number(importanceScore ?? parsed.data.importanceScore)) ? Number(importanceScore ?? parsed.data.importanceScore) : 0.5)),
    updated: now,
    sessions,
  };

  // When new content is supplied, normalize it to begin with the Executive Summary
  // header (idempotent), matching what store_memory writes and what parseFrontmatter
  // yields on the read path — so contentPreview stays consistent with disk.
  const newContent = content ? withExecutiveSummary(content) : parsed.content;
  fs.writeFileSync(meta.filePath, stringifyFrontmatter(newContent, newFm));

  Object.assign(meta, {
    tags: newFm.tags,
    importanceScore: newFm.importanceScore,
    updated: now,
    sessions: newFm.sessions,
    contentPreview: newContent.trim().slice(0, 500),
  });

  contentCache.delete(key);
  scheduleSave();

  if (content) {
    embed(content).then(vec => {
      if (vec) upsertVector(VECTORS_DB, key, vec);
    }).catch(() => {});
  }

  return { key, message: 'Memory updated.' };
}

export function deleteMemory(args: any): any {
  const { key } = args;
  const meta = memIndex[key];
  if (!meta) throw new Error(`Memory not found: ${key}`);

  // If the file was already removed (a repeated delete, or an external removal
  // since the index was loaded), unlinkSync would throw and abort the in-memory
  // cleanup. Swallow the fs error and still drop the index/vector/cache entries so
  // the key is gone regardless of on-disk state.
  try { fs.unlinkSync(meta.filePath); } catch {}
  delete memIndex[key];
  contentCache.delete(key);
  deleteVector(VECTORS_DB, key).catch(() => {});
  scheduleSave();

  return { key, message: 'Memory deleted.' };
}

export function rebuildIndex(): any {
  // Reconcile against disk: add new/updated files, drop deleted ones, and preserve
  // runtime accessCount/lastAccessed for memories that still exist.
  reconcileIndex();
  rebuildInvertedIndex();
  scheduleSave();
  return { message: `Index rebuilt. ${Object.keys(memIndex).length} memories indexed.` };
}