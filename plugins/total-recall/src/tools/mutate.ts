import * as fs from 'fs';
import * as os from 'os';
import { parseFrontmatter, stringifyFrontmatter, withExecutiveSummary } from '../frontmatter.js';
import { clampImportanceScore } from '../ebbinghaus.js';
import { VECTORS_DB, ensureDir } from '../paths.js';
import { reconcileIndex, assertRegularFile } from '../vault-scan.js';
import { rebuildInvertedIndex } from '../tfidf.js';
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
    // Coerce tags to an array: a caller may pass a scalar, or the existing file
    // may carry a scalar `tags` from a hand-edited/teammate-pushed frontmatter.
    // Matches indexFile's Array.isArray guard; without it, a scalar would crash
    // tfidfSearch's meta.tags.join and getRelatedMemories' Set(m.tags).
    tags: Array.isArray(tags ?? parsed.data.tags) ? (tags ?? parsed.data.tags) : [],
    // Clamp to a finite [0, 1] number — see clampImportanceScore in ebbinghaus.ts.
    importanceScore: clampImportanceScore(importanceScore ?? parsed.data.importanceScore),
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

  if (content) embedAndUpsert(key, content);

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