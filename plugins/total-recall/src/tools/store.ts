import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFrontmatter, stringifyFrontmatter, withExecutiveSummary } from '../frontmatter.js';
import { clampImportanceScore } from '../ebbinghaus.js';
import { ORG_VAULT, PERSONAL_VAULT, HOME, ensureDir, NO_PRUNE_TAG } from '../paths.js';
import { slugify, keyFromPath, tokenEstimate, deriveCategory, assertLstat, isReservedKey } from '../vault-scan.js';
import { memIndex } from '../state.js';
import { registerDocument } from '../tfidf.js';
import { contentCache } from '../lru-cache.js';
import { appendJournal } from '../journal.js';
import { scheduleSave, deriveFilePathFromKey } from '../persistence.js';
import { embedAndUpsert } from '../embeddings.js';
import { SECRET_TOKEN_RE } from '../privacy-filter.js';
import { MemoryExistsError } from '../errors.js';
import type { MemoryFrontmatter, MemoryMetadata } from '../types.js';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapHandler } from './registry.js';

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
  const { content, force = false } = args;
  const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined;
  const author = typeof args.author === 'string' ? args.author : undefined;
  const explicitKey = typeof args.key === 'string' ? args.key : undefined;
  const explicitCreated = typeof args.created === 'string' ? args.created : undefined;
  const explicitUpdated = typeof args.updated === 'string' ? args.updated : undefined;
  const explicitSessions = Array.isArray(args.sessions) ? args.sessions : undefined;
  // Coerce category to a string at the WRITE path (mirrors title/tags below):
  // a non-string `category` (e.g. `123`, `null` from a malformed caller) would
  // otherwise reach `category.startsWith('org/')` below and throw TypeError
  // (Number has no startsWith) before the memory is stored. MCP does not
  // enforce the tool's inputSchema, so coerce at the boundary like title/tags.
  const categoryArg = String(args.category ?? 'knowledge');
  const title = String(args.title ?? '');
  const tags = Array.isArray(args.tags)
    ? args.tags
        .map((t: unknown) => (t === null || t === undefined ? '' : typeof t === 'string' ? t : String(t)))
        .filter(Boolean)
    : [];
  // Clamp + coerce importanceScore to a finite [0, 1] number — see
  // clampImportanceScore in ebbinghaus.ts for the full rationale. Centralized
  // so this write path and update_memory / indexFile / coerceMemEntry share one
  // implementation instead of four copies of the clamp expression.
  const importanceScore = clampImportanceScore(args.importanceScore);

  let isOrg: boolean;
  let category: string;
  let filePath: string;
  let key: string;

  if (explicitKey !== undefined) {
    // import_memories (and future bulk restore paths) supply the canonical key.
    // Re-derive the file path from the key instead of from title/category so a
    // round-trip preserves the original location even if the title changed.
    const derivedFilePath = deriveFilePathFromKey(explicitKey);
    if (!derivedFilePath) throw new Error(`Invalid key "${explicitKey}"`);
    filePath = derivedFilePath;
    key = explicitKey;
    isOrg = key.startsWith('org/');
    category = deriveCategory(filePath, isOrg);
  } else {
    isOrg = tags.includes('org');
    const isPersonal = tags.includes('personal');
    if (isOrg && isPersonal) throw new Error("Memory cannot have both 'org' and 'personal' tags.");

    category = categoryArg;
    // The `org/` key prefix is reserved for the org vault (keyFromPath prefixes org
    // keys with `org/`; reconcileIndex skips a personal-vault subdir literally named
    // `org`). A personal memory (no `org` tag) with `category: 'org'` would write to
    // `personal-vault/org/<slug>.md` → key `org/<slug>`, colliding with org-vault keys
    // AND being dropped on the next reconcile (the personal walk skips `org/`) — a
    // silent data-loss footgun. The same trap fires for any `org/`-PREFIXED category
    // (e.g. `org/architecture`): it writes under `personal-vault/org/...`, reconcile
    // skips the whole `org/` subtree of the personal vault, and the file is never
    // indexed — written, invisible to every search/recall/list tool, orphaned until
    // the user manually moves it. Catch the prefix too (not just the exact string),
    // so `category: 'org/something'` is rejected at the source instead of silently
    // lost. Route org memories via the `org` tag, not a reserved `org/` category.
    if (!isOrg && (category === 'org' || category.startsWith('org/'))) {
      throw new Error(
        'Category "' + category + '" starts with the reserved "org/" prefix. The "org/" key prefix is reserved for the shared org vault, and a personal write under it would never be indexed (reconcileIndex skips the personal-vault "org/" subtree), silently orphaning the memory. Use a different category, or tag the memory "org" to route it to the org vault.'
      );
    }

    const slug = slugify(title);
    const catDir = isOrg
      ? path.join(ORG_VAULT, category)
      : path.join(PERSONAL_VAULT, category);
    // `category` is caller-supplied but is containment-checked below (resolved must
    // stay inside the vault root) BEFORE any disk write; the guard runs before
    // ensureDir. Reviewed path-traversal finding; suppressed inline.
    filePath = path.join(catDir, `${slug}.md`); // nosemgrep: path-join-resolve-traversal — containment-guarded below.
    key = keyFromPath(filePath, isOrg);
  }

  // Prototype-pollution guard: keys like `__proto__`, `constructor`, or `prototype`
  // (or any segment containing them) must never become property names on memIndex.
  // deriveFilePathFromKey already rejects reserved explicit keys; this is defense-
  // in-depth for the generated-key path and for any future code path that reaches
  // here with a reserved key.
  if (isReservedKey(key)) {
    throw new Error(`Invalid key "${key}": reserved key segment.`);
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

  // Path-containment guard: `category` is caller-supplied, so a value like
  // "../.." resolves outside the vault and would write an arbitrary file — and,
  // via ensureDir below, create an arbitrary directory. Resolve and confirm the
  // final path stays inside the chosen vault BEFORE creating anything on disk.
  // When an explicit key is provided the same check is performed by
  // deriveFilePathFromKey, but we repeat it here so the error message is explicit
  // about the vault boundary.
  const vaultRoot = path.resolve(isOrg ? ORG_VAULT : PERSONAL_VAULT);
  const resolved = path.resolve(filePath); // nosemgrep: path-join-resolve-traversal — contained by the guard immediately below.
  if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + path.sep)) {
    throw new Error(`Invalid key "${key}": resolves outside the vault.`);
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
  const catDir = path.dirname(filePath);
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
  let supersededAt: string[] | undefined;
  if (fs.existsSync(filePath)) {
    const existingFm = parseFrontmatter(fs.readFileSync(filePath, 'utf8')).data as Partial<MemoryFrontmatter>;
    // Org memories are author-protected regardless of force. Compare against the
    // real OS user; a missing author on an existing org memory is treated as
    // foreign (fail-closed) rather than silently overwritable.
    if (isOrg && existingFm.author !== effectiveAuthor) {
      throw new Error(`Cannot overwrite org memory authored by ${existingFm.author ?? '(unknown)'}.`);
    }
    // Immortal-memory guard (completes the no-prune contract). A `no-prune`-tagged
    // existing memory is refused on store_memory EVEN with force=true — the third
    // removal path. prune_memories excludes it (query.ts) and delete_memory
    // refuses it unless force (mutate.ts); without this guard, store_memory(force)
    // would silently overwrite an ADR's body AND could strip the `no-prune` tag
    // itself (if the re-store's tags omit it), after which the memory is no longer
    // immortal and CAN be pruned/deleted — exactly the "removed by mistake" path
    // the tag exists to prevent. force=true is the universal "I mean it" override
    // for delete, but store_memory(force) is a routine content re-store that
    // quietly strips immortality, so refuse it here. A deliberate teardown still
    // has one loud path: delete_memory(force=true) (which drops the file), then a
    // fresh store. To amend the body without removing the memory, use update_memory
    // (which does NOT strip tags). See NO_PRUNE_TAG in paths.ts.
    const existingTags = Array.isArray(existingFm.tags) ? existingFm.tags : [];
    if (existingTags.includes(NO_PRUNE_TAG)) {
      throw new Error(
        `Memory "${key}" is tagged '${NO_PRUNE_TAG}' (immortal) and cannot be overwritten by store_memory, even with force=true — this would silently rewrite its body and could strip the no-prune tag. ` +
        `Use update_memory to amend it (preserves tags), or delete_memory with force=true first (a deliberate teardown) then re-store.`
      );
    }
    if (!force) {
      // Typed error (6.4): import_memories branches on `instanceof
      // MemoryExistsError` to classify this as "skipped" instead of regex-
      // matching the English message text — which would silently misclassify
      // any future error whose message happened to contain "already exists"
      // and break the moment this message is reworded.
      throw new MemoryExistsError(
        key,
        `Memory "${key}" already exists (created ${existingFm.created ?? 'unknown'}). ` +
        `Use update_memory to modify it, or pass force=true to overwrite.`
      );
    }
    preservedCreated = existingFm.created;
    // Graphiti "supersede, don't overwrite" (Tech Radar vol.34 #45): the prior
    // version of the fact is NOT silently dropped. (1) Archive the existing body
    // to `<vault>/.superseded/<category>/<slug>.<ts>.md` so "what did I believe"
    // is recoverable — the archive is excluded from indexing (EXCLUDED_DIRS),
    // so it never pollutes search/recall/list. (2) Record the supersession
    // moment on the new frontmatter's `supersededAt[]` so "when" is recoverable
    // in-band, without reading the archive. The archive filename embeds the
    // same ISO timestamp (colon-stripped for Windows/Git-Bash safety) so the
    // archived body is locatable from a supersededAt entry. Incremental: a full
    // bi-temporal validity-window + relation layer is a later experiment.
    // Best-effort — an archive write failure must not block the overwrite
    // (the supersededAt marker still records the supersession in-band).
    const supersessionTs = new Date().toISOString();
    try {
      const archiveRoot = path.join(vaultRoot, '.superseded', category);
      ensureDir(archiveRoot);
      const ts = supersessionTs.replace(/[:.]/g, '-');
      const slugBase = path.basename(filePath, '.md');
      const archivePath = path.join(archiveRoot, `${slugBase}.${ts}.md`);
      fs.writeFileSync(archivePath, fs.readFileSync(filePath, 'utf8'));
    } catch { /* best-effort archive; the marker below still records the supersession */ }
    supersededAt = [
      ...(Array.isArray(existingFm.supersededAt) ? existingFm.supersededAt : []),
      supersessionTs,
    ];
    // Preserve prior session history on a force-overwrite (A2). Without this, the
    // spread below reset `sessions` to just `[sessionId]` — or `[]` when no new
    // session was supplied — discarding the accumulated session trail. Mirror
    // update_memory's dedupe-merge so a repeated overwrite never duplicates entries.
    // Coerce to an array: a hand-edited/teammate-pushed frontmatter with a scalar
    // `sessions` value would otherwise be spread as a string (per-character) or
    // throw "is not iterable" on a number, corrupting the session history.
    preservedSessions = Array.isArray(existingFm.sessions) ? existingFm.sessions : [];
  }

  const now = new Date().toISOString();
  // Dedupe-merge the carried-over session history with the current session. Like
  // update_memory, keep only the unique set (order: prior then current) so a
  // force-overwrite extends the history rather than wiping it. Cap at the last 50
  // (mutate.ts:49) — repeated force-overwrites with distinct session IDs would grow
  // `sessions` without bound otherwise, violating the documented "capped at 50"
  // invariant on this write path too.
  const priorSessions = Array.isArray(explicitSessions)
    ? explicitSessions
    : (preservedSessions ?? []);
  const sessions = [...new Set([
    ...priorSessions,
    ...(sessionId ? [sessionId] : []),
  ])].slice(-50);
  const fm: MemoryFrontmatter = {
    title,
    tags,
    author: effectiveAuthor,
    sessions,
    created: explicitCreated ?? preservedCreated ?? now,
    updated: explicitUpdated ?? now,
    importanceScore,
  };
  if (supersededAt !== undefined) fm.supersededAt = supersededAt;

  // withExecutiveSummary is idempotent: if `content` already begins with the
  // header it leaves it intact, so we never double-prefix. The cached value and
  // the contentPreview both derive from this same disk body, so a cache hit and a
  // cache miss (re-read from disk via parseFrontmatter) yield identical content.
  // Coerce to string: MCP does not enforce the schema, and a non-string value
  // (number, null, undefined) would throw TypeError before the memory is stored.
  const body = withExecutiveSummary(content !== undefined ? String(content) : '');
  const fileContent = stringifyFrontmatter(body, fm);
  fs.writeFileSync(filePath, fileContent);

  // 7.4 (REVIEW 7.2): non-blocking stderr warning when the stored content looks
  // like a secret token. The personal vault stores content verbatim and is local
  // (post-Ollama the embedder runs in-process, so nothing leaves the machine), so
  // this is NOT a block — only a one-line stderr hint so a user who pasted a real
  // key into a memory is told it's sitting on disk in the clear. The org-sync path
  // (privacyCheck in sync-org-memory) still hard-blocks a secret from reaching the
  // shared repo; this is the personal-vault belt. SECRET_TOKEN_RE is the known-
  // prefix detector only — the broader labeled-generic/high-entropy detectors
  // are intentionally NOT used here to keep the personal-vault FP rate near zero
  // (a noisy warning the user ignores is worse than no warning).
  try {
    if (SECRET_TOKEN_RE.test(body)) {
      process.stderr.write(
        `total-recall: warning — memory "${title}" looks like it contains a secret token; the personal vault stores content in the clear.\n`,
      );
    }
  } catch { /* best-effort warning; never block a store on it */ }

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
    created: fm.created, updated: fm.updated, importanceScore, category: deriveCategory(filePath, isOrg),
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
  registerDocument(key, meta.title, meta.tags, meta.contentPreview);
  contentCache.set(key, body);

  if (!isOrg) appendJournal('store', key, title);
  scheduleSave();

  embedAndUpsert(key, body);

  return { key, filePath, message: `Memory stored: ${key}` };
}
// ─── Registration (Phase 6.1-6.3: schema co-located with handler) ──────────────
// Raw Zod shape (not z.object()) — McpServer.registerTool wraps it. The shape
// is transcribed verbatim from the pre-migration hand-written JSON schema; the
// SDK's Zod→JSON-Schema converter reproduces it (verified against the golden
// tools/list snapshot in __fixtures__/tools-list-golden.json).
const storeMemorySchema = {
  title: z.string(),
  content: z.string().describe('Full markdown content including executive summary.'),
  tags: z.array(z.string()).optional(),
  category: z.string().default('knowledge'),
  importanceScore: z.number().min(0).max(1).default(0.5),
  sessionId: z.string().optional(),
  author: z.string().optional(),
  force: z.boolean().default(false).describe('Overwrite an existing memory with the same key (preserves created/accessCount).'),
  key: z.string().optional().describe('Explicit memory key (overrides the title/category-derived key). Used by import_memories to preserve the original location on a round-trip; rarely set by hand.'),
  created: z.string().optional().describe('ISO timestamp to record as the creation time (import_memories round-trip). Omit to stamp now.'),
  updated: z.string().optional().describe('ISO timestamp to record as the last-updated time (import_memories round-trip). Omit to stamp now.'),
  sessions: z.array(z.string()).optional().describe('Pre-existing session history to carry over (import_memories round-trip). The current sessionId is appended (deduped, capped at 50).'),
};

export function register(server: McpServer) {
  server.registerTool(
    'store_memory',
    {
      description: 'Store a new memory in the vault. Routes to org vault if tagged "org". Errors if a memory with the same key already exists — use update_memory, or pass force=true to overwrite (preserves created/accessCount). force=true is refused if the existing memory is tagged "no-prune" (immortal) — use update_memory to amend or delete_memory(force=true) then re-store.',
      inputSchema: storeMemorySchema,
    },
    wrapHandler('store_memory', storeMemory),
  );
}
