import * as fs from 'fs';
import * as path from 'path';
import {
  INDEX_PATH,
  INVERTED_INDEX_PATH,
  INDEX_CACHE_PATH,
  ORG_VAULT,
  PERSONAL_VAULT,
  ensureDir,
} from './paths.js';
import { clampImportanceScore } from './ebbinghaus.js';
import { memIndex, invertedIndex, recordError } from './state.js';
import { rebuildInvertedIndex } from './tfidf.js';
import * as crypto from 'crypto';

// Debounce timers live here (only this module touches them).
let indexSaveTimer: ReturnType<typeof setTimeout> | null = null;
let idfTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Index persistence ───────────────────────────────────────────────────────

// Write-then-rename so a SIGKILL / power loss mid-write can't leave index.json,
// invertedIndex.json, or .index-cache.txt half-truncated (which would corrupt
// the index and lose all metadata on the next boot). rename is atomic on POSIX.
function atomicWrite(p: string, data: string) {
  ensureDir(path.dirname(p));
  // Random tmp suffix (not a predictable `${p}.tmp`): a local attacker who can
  // write the vault dir could pre-plant a symlink at the predictable tmp path
  // pointing at an outside file, and writeFileSync(tmp) would follow it and
  // clobber the target. randomBytes makes the tmp path unguessable, closing the
  // symlink-race escalation (write-to-vault → clobber-any-user-writable-file).
  const tmp = `${p}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, data);
  } catch {
    // Tmp write failed (ENOSPC / EACCES / EROFS / EISDIR). atomicWrite is
    // called from debounced setTimeout callbacks AND from flushPending on the
    // SIGTERM/SIGINT/beforeExit path; an uncaught throw here escapes the timer
    // callback → uncaughtException → the stdio server dies mid-session (index.ts
    // registers no uncaughtException handler). Fall back to a direct overwrite
    // of the target (loses POSIX atomicity, same trade-off as the rename-fallback
    // below) rather than crashing. The .md files are already durable and
    // reconcileIndex rebuilds the index on next boot, so a transient I/O error
    // must not take the process down. Callers (scheduleSave / scheduleIdfRecalc
    // / flushPending) additionally wrap their own bodies so a remaining throw is
    // recorded via recordError, not fatal.
    try { fs.writeFileSync(p, data); } catch (e) { recordError(`atomicWrite(${p}): ${(e as Error).message}`); }
    return;
  }
  try {
    fs.renameSync(tmp, p);
  } catch {
    // rename can fail on Windows (open handles / cross-volume); fall back to
    // a direct overwrite — loses POSIX atomicity but avoids a hard crash.
    fs.writeFileSync(p, data);
    try { fs.unlinkSync(tmp); } catch { /* best-effort cleanup */ }
  }
}

function loadIndex<T extends Record<string, unknown>>(target: T, p: string) {
  // Clear-then-populate the shared singleton (formerly `target = JSON.parse(...)`).
  for (const k of Object.keys(target)) delete (target as any)[k];
  // nosemgrep: insecure-object-assign — `p` is the plugin's OWN index.json (plugin-written, not user input); reviewed.
  try { Object.assign(target, JSON.parse(fs.readFileSync(p, 'utf8'))); } catch { /* empty */ }
}

// Per-entry coercion on the memIndex restore path. A pre-v1.0.6 install may
// have written a Number title (`title: 2026` from a teammate-pushed org file
// before indexFile's String() coercion landed) or a scalar-string tags value
// into index.json. The in-memory type is strict (`MemoryMetadata.title: string`,
// `tags: string[]`), so a raw JSON.parse would re-introduce those bad values
// on the very first boot after upgrade. Coerce on restore so the read-side
// callers — buildIndexCache (`m.title.slice`), tfidfSearch
// (`meta.title.toLowerCase`, `meta.tags.some/join`), getRelatedMemories
// (`Set(m.tags)`), query (`m.tags.includes`) — never see a non-string title or
// non-array tags. Mirrors the indexFile read-path hardening for the
// load-from-on-disk-cache path.
// Re-derive filePath from the memIndex key, discarding any persisted filePath.
// The key is the trusted lookup token — a vault-relative path (`knowledge/foo`)
// with an `org/` prefix for org memories — so filePath must always be
// `<vault>/<rel>.md`. A poisoned index.json could set `filePath: '/etc/shadow'`;
// worse, the ORG vault's `index.json` IS git-synced, so a teammate with push
// access can plant one. Tools pass `meta.filePath` straight to fs.*Sync
// (query.ts get_memories_by_keys, recall.ts, mutate.ts delete_memory) →
// arbitrary read AND arbitrary delete. Never trust a persisted filePath:
// rebuild it from the validated key and containment-check the result. Reject
// keys that could escape when joined (`..`/`.` segments, leading `/`, `\`,
// null bytes, empty segments); return null on any failure so the caller drops
// the entry rather than indexing a path that points outside the vault.
function deriveFilePathFromKey(key: unknown): string | null {
  if (typeof key !== 'string' || !key) return null;
  if (key.includes('\0') || key.includes('\\')) return null;
  const isOrg = key.startsWith('org/');
  const rel = isOrg ? key.slice('org/'.length) : key;
  if (!rel || rel.startsWith('/') || rel.includes('//')) return null;
  const segments = rel.split('/');
  if (segments.some(s => s === '..' || s === '.' || s === '')) return null;
  const base = isOrg ? ORG_VAULT : PERSONAL_VAULT;
  const filePath = path.join(base, rel + '.md');
  const vaultRoot = path.resolve(base);
  const resolved = path.resolve(filePath);
  if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + path.sep)) return null;
  return filePath;
}

// `key` is the memIndex key (the JSON object key in index.json) — the trusted
// identity of the entry, independent of any (possibly poisoned) `key`/`filePath`
// fields inside the entry. filePath is re-derived from it (see
// deriveFilePathFromKey); the inner `key` field is normalized to match.
function coerceMemEntry(raw: unknown, key: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const filePath = deriveFilePathFromKey(key);
  if (!filePath) return null;
  return {
    ...e,
    key,        // normalize to the trusted memIndex key (discard any inner key)
    filePath,   // re-derived + containment-checked; discards any persisted filePath
    title: String(e.title ?? ''),
    tags: Array.isArray(e.tags) ? e.tags : [],
    sessions: Array.isArray(e.sessions) ? e.sessions : [],
    // Clamp + coerce importanceScore to a finite [0, 1] number — see
    // clampImportanceScore in ebbinghaus.ts.
    importanceScore: clampImportanceScore(e.importanceScore),
  };
}

function loadMemIndex() {
  for (const k of Object.keys(memIndex)) delete (memIndex as any)[k];
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); } catch { return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const coerced = coerceMemEntry(v, k);
    if (coerced) (memIndex as any)[k] = coerced;
  }
}

export function loadIndexes() {
  loadMemIndex();
  loadIndex(invertedIndex, INVERTED_INDEX_PATH);
}

export function scheduleSave() {
  if (indexSaveTimer) clearTimeout(indexSaveTimer);
  indexSaveTimer = setTimeout(() => {
    // A throw inside a setTimeout callback fires uncaughtException (index.ts
    // registers no handler) and kills the stdio server mid-session. atomicWrite
    // now falls back rather than throwing on transient I/O, but JSON.stringify
    // of an odd memIndex shape or a scheduleIdfRecalc failure could still throw
    // — record to the shared `errors` singleton (bounded in state.ts via
    // recordError) and never rethrow from an async timer.
    try {
      atomicWrite(INDEX_PATH, JSON.stringify(memIndex, null, 2));
      scheduleIdfRecalc();
    } catch (e) {
      recordError(`scheduleSave: ${(e as Error).message}`);
      try { console.error(e); } catch { /* stderr closed — ignore */ }
    }
  }, 1000);
}

export function scheduleIdfRecalc() {
  if (idfTimer) clearTimeout(idfTimer);
  idfTimer = setTimeout(() => {
    try {
      rebuildInvertedIndex();
      atomicWrite(INVERTED_INDEX_PATH, JSON.stringify(invertedIndex, null, 2));
      buildIndexCache();
    } catch (e) {
      recordError(`scheduleIdfRecalc: ${(e as Error).message}`);
      try { console.error(e); } catch { /* stderr closed — ignore */ }
    }
  }, 2000);
}

// ─── Flush on exit ────────────────────────────────────────────────────────────
// The MCP stdio server is killed when the client disconnects, so debounced
// save/IDF timers (1s + 2s) can be lost. Flush pending writes synchronously on
// SIGTERM/SIGINT/beforeExit so the index never lags behind the .md files (which
// are written synchronously and are always durable).

export function saveNow() {
  atomicWrite(INDEX_PATH, JSON.stringify(memIndex, null, 2));
}

export function recalcIdfNow() {
  rebuildInvertedIndex();
  atomicWrite(INVERTED_INDEX_PATH, JSON.stringify(invertedIndex, null, 2));
  buildIndexCache();
}

export function flushPending() {
  if (!indexSaveTimer && !idfTimer) return;
  if (indexSaveTimer) clearTimeout(indexSaveTimer);
  if (idfTimer) clearTimeout(idfTimer);
  indexSaveTimer = null;
  idfTimer = null;
  // Isolate the two writes: if saveNow throws (transient I/O), recalcIdfNow
  // must still run, and the throw must not propagate out of the SIGTERM/SIGINT
  // handler in index.ts (which would skip process.exit(0) and die via
  // uncaughtException). atomicWrite already swallows its own throws; this belt-
  // and-braces catch guards anything atomicWrite doesn't (e.g. a throw inside
  // rebuildInvertedIndex/buildIndexCache). Log to stderr + record; both writes
  // are best-effort and reconcileIndex rebuilds on next boot.
  try { saveNow(); } catch (e) { recordError(`flushPending saveNow: ${(e as Error).message}`); try { console.error('flushPending saveNow:', e); } catch { /* stderr closed */ } }
  try { recalcIdfNow(); } catch (e) { recordError(`flushPending recalcIdfNow: ${(e as Error).message}`); try { console.error('flushPending recalcIdfNow:', e); } catch { /* stderr closed */ } }
}

// ─── Index cache (shell-readable) ────────────────────────────────────────────

export function buildIndexCache() {
  const entries = Object.values(memIndex);
  const lines = [`${entries.length}`];
  for (const m of entries) {
    const shortTitle = m.title.slice(0, 40);
    const tags = m.tags.slice(0, 3).join(', ') + (m.tags.length > 3 ? ', ...' : '');
    lines.push(`- ${m.key}: ${shortTitle} [${tags}] (${m.category})`);
  }
  ensureDir(path.dirname(INDEX_CACHE_PATH));
  atomicWrite(INDEX_CACHE_PATH, lines.join('\n'));
}