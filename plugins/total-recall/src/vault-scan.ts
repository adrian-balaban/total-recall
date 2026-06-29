import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatter } from './frontmatter.js';
import { clampImportanceScore } from './ebbinghaus.js';
import {
  PERSONAL_VAULT,
  ORG_VAULT,
  EXCLUDED_DIRS,
  VECTORS_DB,
  ensureDir,
} from './paths.js';
import { memIndex, errors } from './state.js';
import { contentCache } from './lru-cache.js';
import { deleteVector } from './vectorStore.js';
import type { MemoryFrontmatter } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  // An empty/whitespace title would otherwise produce a `.md` filename and a
  // key like `knowledge/.md`; fall back to a stable slug instead.
  return slug || 'untitled';
}

export function keyFromPath(filePath: string, isOrg: boolean): string {
  const base = isOrg ? ORG_VAULT : PERSONAL_VAULT;
  const rel = path.relative(base, filePath).replace(/\.md$/, '');
  return isOrg ? `org/${rel}` : rel;
}

export function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

// Assert the on-disk entry at `filePath` is a regular file, not a symlink or
// directory. Used at read sites (recall.ts, query.ts) to close the post-index-swap
// read leak that indexFile's scan-time lstat guard (Pass 1) does NOT cover. The MCP
// server is long-lived and reconcileIndex runs only at boot, so a SessionStart
// `git pull` on the shared org vault can swap an already-indexed regular file for a
// symlink (`org/existing.md` -> `~/.ssh/id_rsa` or any victim-readable file) WITHOUT
// re-scanning memIndex — the walk's e.isSymbolicLink() skip (above) never re-runs.
// A subsequent readFileSync(meta.filePath) would follow the link and dump the
// target into the MCP response (-> LLM context): the same Confidentiality class as
// SEC-001 (closed at scan time) but via the post-swap window. lstatSync stats the
// entry itself (not the target), so a symlink reports isFile()=false and is
// rejected regardless of what it points at — the caller's existing catch returns
// an error/empty fail-closed instead of following the link. ENOENT (the file was
// removed since the index loaded) is allowed to fall through to readFileSync,
// which throws a clear error the caller already handles. Mirrors the inline guards
// in store.ts:122-136 and mutate.ts:32-38 (the write path Pass 1 / Pass 5 closed);
// factored out so the read paths share one implementation.
export function assertRegularFile(filePath: string, key: string): void {
  try {
    if (!fs.lstatSync(filePath).isFile()) {
      throw new Error(`Memory "${key}" is not a regular file (symlink or directory) — refusing to follow a possible planted link in the shared org vault.`);
    }
  } catch (e: any) {
    if (!e || e.code !== 'ENOENT') throw e; // ENOENT = file removed since load, fine
  }
}

// Read a memory file's body (frontmatter stripped) with the symlink guard.
// Consolidates the assertRegularFile + readFileSync + parseFrontmatter + try/catch
// core that was inlined across recall_memory(full), get_memories_by_keys (summary
// AND full), and get_related_memories(includeContent) — four copies of the same
// symlink-guarded read. Returns the body string on success, which may be '' for an
// empty-bodied memory (a VALID result, NOT a failure), or null on any failure
// (assertRegularFile rejected a swapped symlink/dir, readFileSync threw, or
// parseFrontmatter threw). The null/'' split is the point: callers must NOT
// conflate an empty body with a failed read when deciding whether to cache the
// result or bump access — null means "don't cache, signal failure", '' means
// "cache it, it's a real empty body". The cache-check policy (truthy `!content`
// vs strict `=== undefined`) and the access-bump policy (unconditional / iff-readOk
// / none) differ per call site and are intentionally NOT unified here — callers
// keep their own; this helper owns only the safe read.
export function readMemoryContent(filePath: string, key: string): string | null {
  try {
    assertRegularFile(filePath, key);
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseFrontmatter(raw).content;
  } catch {
    return null;
  }
}

// ─── Full vault scan ─────────────────────────────────────────────────────────

// Reconcile the in-memory index against disk: add new/updated files, drop keys
// whose file no longer exists, and preserve runtime access stats for survivors.
// Used both at boot (so orphaned files from a missed flush and newly pulled org
// memories surface) and by rebuild_index (so it no longer wipes accessCount).
export function reconcileIndex() {
  const before = new Set(Object.keys(memIndex));
  const seen = new Set<string>();
  const walk = (dir: string, isOrg: boolean) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      // Skip symlinks entirely. `git pull` preserves symlinks, so a teammate
      // with push access to the shared org vault can plant a symlink named
      // `*.md` → `~/.ssh/id_rsa` (or any victim-readable file), or a symlinked
      // directory pointing outside the vault. Without this guard, a
      // symlink-to-a-directory is treated as a directory (recursing outside the
      // vault) and a symlink-to-a-file ending in `.md` is indexed — and
      // indexFile's readFileSync follows it, dumping the target's contents into
      // contentPreview (surfaced via search_index / get_memories_by_keys /
      // recall_memory(full)). Dirent.isSymbolicLink() detects the link itself
      // (not the target), so this fires before the isDirectory/endsWith branches
      // below. The privacy filter never runs on pulled content, so this
      // index-time skip is the only barrier against the read-side leak.
      if (e.isSymbolicLink()) continue;
      // `e.name` is a filesystem-discovered entry from readdirSync (excludes
      // `.`/`..`; filenames can't contain `/`), and `dir` is vault-rooted by the
      // walk. Not caller-supplied. Reviewed path-traversal finding; suppressed inline.
      const fp = path.join(dir, e.name); // nosemgrep: path-join-resolve-traversal — filesystem-discovered name, vault-rooted walk.
      if (e.isDirectory()) {
        // Reserve the `org/` key prefix for the ORG vault. A personal-vault
        // subdir literally named `org` would index files to keys like `org/x`,
        // colliding with (and shadowing) org-vault keys (`org/<rel>`). Skip it
        // on the personal walk so the org namespace stays unambiguous.
        const reservedOrgPrefix = !isOrg && e.name === 'org';
        if (!EXCLUDED_DIRS.has(e.name.toLowerCase()) && !reservedOrgPrefix) walk(fp, isOrg);
      } else if (e.name.endsWith('.md')) {
        indexFile(fp, isOrg);
        seen.add(keyFromPath(fp, isOrg));
      }
    }
  };
  ensureDir(PERSONAL_VAULT);
  ensureDir(ORG_VAULT);
  walk(PERSONAL_VAULT, false);
  walk(ORG_VAULT, true);
  // Drop index entries whose file vanished since the last scan, AND purge their
  // cached content + vector embedding so a deleted/orphaned memory can't resurface
  // through the vector search path (searchVector reads vec_memories directly and
  // does not consult memIndex). Fire-and-forget: deleteVector no-ops when the
  // optional sqlite-vec deps are absent.
  for (const key of before) {
    if (!seen.has(key)) {
      delete memIndex[key];
      contentCache.delete(key);
      deleteVector(VECTORS_DB, key).catch(() => {});
    }
  }
}

export function indexFile(filePath: string, isOrg: boolean) {
  try {
    // Defense-in-depth against symlink traversal. The reconcileIndex walk skips
    // symlinks (e.isSymbolicLink() above), but indexFile is exported and could
    // be called with a caller-supplied path, so guard here too. lstatSync stats
    // the path itself (not the target): a symlink — dangling or pointing at
    // `~/.ssh/id_rsa` or any victim-readable file — returns isSymbolicLink()=true
    // and is rejected, so readFileSync below can't follow a link out of the vault
    // and leak the target into contentPreview. realpathSync then resolves through
    // any link in the path and we re-check containment against the realpath'd
    // vault root — closing the lexical-only gap of path.resolve for the read
    // path. (A teammate can plant a symlink via the org vault's `git pull`, which
    // preserves symlinks; the privacy filter never runs on pulled content.)
    const base = isOrg ? ORG_VAULT : PERSONAL_VAULT;
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) return;
    } catch { return; }
    const realBase = fs.realpathSync(base);
    const realFile = fs.realpathSync(filePath);
    if (realFile !== realBase && !realFile.startsWith(realBase + path.sep)) return;

    const raw = fs.readFileSync(filePath, 'utf8');
    const { data, content } = parseFrontmatter(raw);
    const fm = data as Partial<MemoryFrontmatter>;
    const key = keyFromPath(filePath, isOrg);
    // Re-index from disk but preserve runtime stats (accessCount, lastAccessed)
    // accumulated since the last scan. Applies to personal AND org memories — org
    // entries are now refreshed too (previously skipped via the !memIndex[key] guard,
    // which left org contentPreview/tags stale after a git pull).
    const existing = memIndex[key];
    // Single scan-time "now" per file. Without this, `created`, `updated`, and
    // `lastAccessed` each call `new Date()` independently — across an N-file
    // reconcileIndex sweep, two fallbacks in the same file can land on either
    // side of a millisecond boundary, producing a `created` later than
    // `updated` (impossible ordering) and a `lastAccessed` distinct from both.
    // Capture once; reuse for the three fallback fields.
    const now = new Date().toISOString();
    memIndex[key] = {
      key,
      filePath,
      // Coerce title to a string: a hand-edited (or teammate-pushed, via the shared
      // org vault) frontmatter with an UNQUOTED numeric title (`title: 2026`) is
      // parsed by coerceScalar into a Number. That would later crash tfidfSearch's
      // `meta.title.toLowerCase()` and buildIndexCache's `m.title.slice()` (the
      // latter in a debounced timer → uncaught throw → process crash). The writer
      // always quotes numeric-looking titles, so this only affects externally
      // authored files — but the threat model is the same as the frontmatter-key
      // ReDoS hardening (teammate-pushed malformed frontmatter).
      title: String(fm.title ?? path.basename(filePath, '.md')),
      // Coerce arrays defensively: a teammate-pushed (or hand-edited) frontmatter
      // with a scalar `tags: foo` or `sessions: bar` would otherwise crash
      // tfidfSearch (meta.tags.some/join) and getRelatedMemories (Set(m.tags)) —
      // the same externally-authored threat model as the numeric-title coercion.
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      author: fm.author,
      sessions: Array.isArray(fm.sessions) ? fm.sessions : [],
      created: fm.created ?? now,
      updated: fm.updated ?? now,
      // Coerce + clamp importanceScore to a finite [0, 1] number — see
      // clampImportanceScore in ebbinghaus.ts.
      importanceScore: clampImportanceScore(fm.importanceScore),
      category: deriveCategory(filePath, isOrg),
      contentPreview: content.trim().slice(0, 500),
      accessCount: existing?.accessCount ?? 0,
      lastAccessed: existing?.lastAccessed ?? now,
      tokenEstimate: tokenEstimate(raw),
      isOrg,
    };
    // Invalidate any cached content for this key: indexFile re-reads from disk
    // (boot, reconcile, rebuild_index), so the cached body may now be stale (e.g.
    // an org git pull updated the file, or an external edit changed it).
    // recall_memory(full=true) and get_memories_by_keys read through contentCache —
    // drop the entry so they re-read fresh content instead of serving the old body
    // for up to the 30-min LRU TTL.
    contentCache.delete(key);
  } catch (e: any) {
    errors.push({ time: new Date().toISOString(), msg: `indexFile ${filePath}: ${e.message}` });
  }
}

export function deriveCategory(filePath: string, isOrg: boolean): string {
  const base = isOrg ? ORG_VAULT : PERSONAL_VAULT;
  const rel = path.relative(base, filePath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : 'knowledge';
}