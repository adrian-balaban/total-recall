import * as fs from 'fs';
import * as os from 'os';
import { parseFrontmatter, stringifyFrontmatter, withExecutiveSummary } from '../frontmatter.js';
import { clampImportanceScore } from '../ebbinghaus.js';
import { VECTORS_DB, NO_PRUNE_TAG } from '../paths.js';
import { reconcileIndex, assertRegularFile, tokenEstimate } from '../vault-scan.js';
import { rebuildInvertedIndex, registerDocument, deregisterDocument } from '../tfidf.js';
import { memIndex } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { scheduleSave } from '../persistence.js';
import { embedAndUpsert } from '../embeddings.js';
import { deleteVector } from '../vectorStore.js';
import type { MemoryFrontmatter } from '../types.js';

export function updateMemory(args: any): any {
  const { key, content, tags, importanceScore, sessionId } = args;
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
    tags: Array.isArray(tags) ? tags : (Array.isArray(parsed.data.tags) ? parsed.data.tags : []),
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
  const newContent = content !== undefined ? withExecutiveSummary(content) : parsed.content;
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

  // Re-embed whenever a search-relevant dimension changes: content, tags, or
  // importanceScore. A tag-only or importance-only update changes what should
  // surface in hybrid search / pruning, so the old vector (built from the stale
  // tags/score context) must be replaced. Use coerced previous values so a
  // malformed scalar tags arg is treated as "no change" rather than a false
  // diff against an array-typed default.
  const previousTags = Array.isArray(parsed.data.tags) ? parsed.data.tags : [];
  const tagsChanged = Array.isArray(tags) && JSON.stringify(tags) !== JSON.stringify(previousTags);
  const previousImportance = clampImportanceScore(parsed.data.importanceScore);
  const importanceChanged = importanceScore !== undefined && Number(importanceScore) !== previousImportance;
  if (content !== undefined || tagsChanged || importanceChanged) embedAndUpsert(key, newContent);

  return { key, message: 'Memory updated.' };
}

export function deleteMemory(args: any): any {
  const { key, force = false } = args;
  const meta = memIndex[key];
  if (!meta) throw new Error(`Memory not found: ${key}`);

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

export function rebuildIndex(): any {
  // Reconcile against disk: add new/updated files, drop deleted ones, and preserve
  // runtime accessCount/lastAccessed for memories that still exist.
  reconcileIndex();
  rebuildInvertedIndex();
  scheduleSave();
  return { message: `Index rebuilt. ${Object.keys(memIndex).length} memories indexed.` };
}