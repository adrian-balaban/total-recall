import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFrontmatter, stringifyFrontmatter, withExecutiveSummary } from '../frontmatter.js';
import { clampImportanceScore } from '../ebbinghaus.js';
import { ORG_VAULT, PERSONAL_VAULT, HOME, ensureDir } from '../paths.js';
import { slugify, keyFromPath, tokenEstimate, deriveCategory, assertLstat } from '../vault-scan.js';
import { memIndex } from '../state.js';
import { contentCache } from '../lru-cache.js';
import { appendJournal } from '../journal.js';
import { scheduleSave } from '../persistence.js';
import { embedAndUpsert } from '../embeddings.js';
import type { MemoryFrontmatter, MemoryMetadata } from '../types.js';

// ─── MCP Tools implementation ─────────────────────────────────────────────────

// Whether the shared org vault has been configured (config `orgRepo` set, or the
// repo cloned). See A3 guard in storeMemory. Reads config.json defensively — a
// missing/corrupt config is treated as "not configured".
export function orgVaultConfigured(): boolean {
  try {
    const cfgPath = path.join(HOME, '.total-recall', 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.orgRepo === 'string' && parsed.orgRepo) return true;
  } catch { /* fall through to the .git check */ }
  return fs.existsSync(path.join(HOME, '.total-recall', 'org', '.git'));
}

export function storeMemory(args: any): any {
  // Defensive coercion at the WRITE path (mirrors indexFile's read-path coercion):
  // MCP does not enforce the tool's inputSchema, so a misbehaving caller — buggy
  // agent, hostile plugin consumer, hand-crafted stdio request — can pass
  // `title: 12345` or `tags: "kafka,cdc"`. Without coercing here, slugify(title)
  // throws (Number has no toLowerCase) and `tags.includes` silently accepts a
  // scalar string that then crashes tfidfSearch (`meta.tags.join/.some`),
  // buildIndexCache (`m.tags.slice`), and getRelatedMemories (`Set(m.tags)`)
  // on the next read. Coerce at the destructure so every downstream use is
  // safe — same blast radius the indexFile hardening guards against for
  // externally-authored frontmatter.
  const { content, category = 'knowledge', sessionId, author, force = false } = args;
  const title = String(args.title ?? '');
  const tags = Array.isArray(args.tags) ? args.tags : [];
  // Clamp + coerce importanceScore to a finite [0, 1] number — see
  // clampImportanceScore in ebbinghaus.ts for the full rationale. Centralized
  // so this write path and update_memory / indexFile / coerceMemEntry share one
  // implementation instead of four copies of the clamp expression.
  const importanceScore = clampImportanceScore(args.importanceScore);
  const isOrg = tags.includes('org');
  const isPersonal = tags.includes('personal');
  if (isOrg && isPersonal) throw new Error("Memory cannot have both 'org' and 'personal' tags.");

  // The `org/` key prefix is reserved for the org vault (keyFromPath prefixes org
  // keys with `org/`; reconcileIndex skips a personal-vault subdir literally named
  // `org`). A personal memory (no `org` tag) with `category: 'org'` would write to
  // `personal-vault/org/<slug>.md` → key `org/<slug>`, colliding with org-vault keys
  // AND being dropped on the next reconcile (the personal walk skips `org/`) — a
  // silent data-loss footgun. Reject it; route to the org vault via the `org` tag.
  if (!isOrg && category === 'org') {
    throw new Error(
      'Category "org" is reserved for the shared org vault. Use a different category, or tag the memory "org" to route it to the org vault.'
    );
  }

  // Org-config guard (A3): refuse an org store when the shared org vault is not
  // configured. Otherwise ensureDir(catDir) below would create `~/.total-recall/
  // org/org-vault/<category>` AND write the memory file in an environment where
  // the org git repo was never set up — leaving an unsynced stray file/dir that
  // then blocks the next `git clone` of the org vault (clone into a non-empty dir
  // fails). Treat "configured" as EITHER the `orgRepo` being set in config.json OR
  // the org git repo having been cloned (`~/.total-recall/org/.git` present).
  if (isOrg && !orgVaultConfigured()) {
    throw new Error(
      'Org vault is not configured. Tag a memory "org" only after enabling the shared org vault: ' +
      'set "orgRepo" in ~/.total-recall/config.json and clone it (see the install skill). ' +
      'Writing now would leave an unsynced file that blocks the next clone.'
    );
  }

  const slug = slugify(title);
  const catDir = isOrg
    ? path.join(ORG_VAULT, category)
    : path.join(PERSONAL_VAULT, category);
  // `category` is caller-supplied but is containment-checked below (resolved must
  // stay inside the vault root) BEFORE any disk write; the guard runs before
  // ensureDir. Reviewed path-traversal finding; suppressed inline.
  const filePath = path.join(catDir, `${slug}.md`); // nosemgrep: path-join-resolve-traversal — containment-guarded below.
  const key = keyFromPath(filePath, isOrg);
  // Path-containment guard: `category` is caller-supplied, so a value like
  // "../.." resolves outside the vault and would write an arbitrary file — and,
  // via ensureDir below, create an arbitrary directory. Resolve and confirm the
  // final path stays inside the chosen vault BEFORE creating anything on disk.
  const vaultRoot = path.resolve(isOrg ? ORG_VAULT : PERSONAL_VAULT);
  const resolved = path.resolve(filePath); // nosemgrep: path-join-resolve-traversal — contained by the guard immediately below.
  if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + path.sep)) {
    throw new Error(`Invalid category "${category}": resolves outside the vault.`);
  }
  // Symlink containment: the path.resolve check above is LEXICAL — it normalizes
  // `.`/`..` as string ops and never calls stat/readlink, so it does NOT detect a
  // symlink. A local attacker (or a teammate who planted a symlink via the org
  // vault's `git pull`, which preserves symlinks) can make either the category
  // dir or a pre-existing `slug.md` a symlink pointing anywhere; the lexical
  // check passes (both lexical paths are inside the vault) but writeFileSync
  // below would follow the link and write outside the vault — clobbering an
  // arbitrary file, or (for a dangling symlink) creating a file at the link's
  // target. Both catDir and filePath must be real filesystem entries before we
  // create or write anything: a category dir must be a real directory, and an
  // existing target must be a real file. lstatSync stats the entry itself (not
  // the target), so a symlink-to-dir reports isDirectory()=false and a
  // symlink-to-file reports isFile()=false — both rejected. ENOENT (the entry
  // doesn't exist yet) is the normal "new category / new file" case and is
  // allowed through to ensureDir/writeFileSync. This closes the planted-symlink
  // write-escape; it is not a TOCTOU-proof guard against a microsecond swap
  // race, which would need O_NOFOLLOW per-component opens.
  assertLstat(
    catDir,
    (s) => s.isDirectory(),
    `Invalid category "${category}": category path is not a real directory (symlink or file).`
  );
  assertLstat(
    filePath,
    (s) => s.isFile(),
    `Memory "${key}" already exists as a non-file entry (symlink or directory).`
  );
  ensureDir(catDir);
  // Org memories are always attributed to the real OS user — never trust a
  // caller-supplied `author` for org, or any caller could pass the existing
  // author's name and bypass the org-author guard below. Personal memories may
  // still carry an explicit author for attribution.
  const osUser = os.userInfo().username;
  const effectiveAuthor = isOrg ? osUser : (author ?? osUser);

  let preservedCreated: string | undefined;
  let preservedSessions: string[] | undefined;
  if (fs.existsSync(filePath)) {
    const existingFm = parseFrontmatter(fs.readFileSync(filePath, 'utf8')).data as Partial<MemoryFrontmatter>;
    // Org memories are author-protected regardless of force. Compare against the
    // real OS user; a missing author on an existing org memory is treated as
    // foreign (fail-closed) rather than silently overwritable.
    if (isOrg && existingFm.author !== effectiveAuthor) {
      throw new Error(`Cannot overwrite org memory authored by ${existingFm.author ?? '(unknown)'}.`);
    }
    if (!force) {
      throw new Error(
        `Memory "${key}" already exists (created ${existingFm.created ?? 'unknown'}). ` +
        `Use update_memory to modify it, or pass force=true to overwrite.`
      );
    }
    preservedCreated = existingFm.created;
    // Preserve prior session history on a force-overwrite (A2). Without this, the
    // spread below reset `sessions` to just `[sessionId]` — or `[]` when no new
    // session was supplied — discarding the accumulated session trail. Mirror
    // update_memory's dedupe-merge so a repeated overwrite never duplicates entries.
    preservedSessions = existingFm.sessions;
  }

  const now = new Date().toISOString();
  // Dedupe-merge the carried-over session history with the current session. Like
  // update_memory, keep only the unique set (order: prior then current) so a
  // force-overwrite extends the history rather than wiping it. Cap at the last 50
  // (mutate.ts:49) — repeated force-overwrites with distinct session IDs would grow
  // `sessions` without bound otherwise, violating the documented "capped at 50"
  // invariant on this write path too.
  const sessions = [...new Set([
    ...(preservedSessions ?? []),
    ...(sessionId ? [sessionId] : []),
  ])].slice(-50);
  const fm: MemoryFrontmatter = {
    title,
    tags,
    author: effectiveAuthor,
    sessions,
    created: preservedCreated ?? now,
    updated: now,
    importanceScore,
  };

  // withExecutiveSummary is idempotent: if `content` already begins with the
  // header it leaves it intact, so we never double-prefix. The cached value and
  // the contentPreview both derive from this same disk body, so a cache hit and a
  // cache miss (re-read from disk via parseFrontmatter) yield identical content.
  const body = withExecutiveSummary(content);
  const fileContent = stringifyFrontmatter(body, fm);
  fs.writeFileSync(filePath, fileContent);

  const existing = memIndex[key];
  // #19: capture the just-written file's stat so the next reconcileIndex can
  // skip re-reading it. statSync follows symlinks, but store_memory already
  // rejected symlinked target paths upstream (the planted-symlink guard), so
  // the path is a regular file we just wrote. Best-effort: a throw here
  // (shouldn't happen — we just wrote the file) leaves 0/0, which forces a
  // re-read on the next reconcile — harmless, just no skip.
  let mtimeMs = 0, size = 0;
  try { const st = fs.statSync(filePath); mtimeMs = st.mtimeMs; size = st.size; } catch { /* best-effort */ }
  const meta: MemoryMetadata = {
    key, filePath, title, tags,
    created: fm.created, updated: now, importanceScore, category: deriveCategory(filePath, isOrg),
    contentPreview: body.trim().slice(0, 500),
    accessCount: existing?.accessCount ?? 0,
    lastAccessed: existing?.lastAccessed ?? now,
    tokenEstimate: tokenEstimate(fileContent), isOrg,
    mtimeMs, size,
  };
  // exactOptionalPropertyTypes: conditionally attach optional fields only when
  // defined; assigning `undefined` to `author?: string` is a type error under EOPT
  // (a present-but-undefined key differs from an absent one).
  if (fm.author !== undefined) meta.author = fm.author;
  if (fm.sessions !== undefined) meta.sessions = fm.sessions;
  memIndex[key] = meta;
  contentCache.set(key, body);

  if (!isOrg) appendJournal('store', key, title);
  scheduleSave();

  embedAndUpsert(key, content);

  return { key, filePath, message: `Memory stored: ${key}` };
}