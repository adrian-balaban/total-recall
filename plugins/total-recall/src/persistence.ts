import * as fs from 'fs';
import * as path from 'path';
import {
  INDEX_PATH,
  INVERTED_INDEX_PATH,
  INDEX_CACHE_PATH,
  ensureDir,
} from './paths.js';
import { memIndex, invertedIndex } from './state.js';
import { rebuildInvertedIndex } from './tfidf.js';

// Debounce timers live here (only this module touches them).
let indexSaveTimer: ReturnType<typeof setTimeout> | null = null;
let idfTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Index persistence ───────────────────────────────────────────────────────

// Write-then-rename so a SIGKILL / power loss mid-write can't leave index.json,
// invertedIndex.json, or .index-cache.txt half-truncated (which would corrupt
// the index and lose all metadata on the next boot). rename is atomic on POSIX.
function atomicWrite(p: string, data: string) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, data);
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
function coerceMemEntry(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  return {
    ...e,
    title: String(e.title ?? ''),
    tags: Array.isArray(e.tags) ? e.tags : [],
    sessions: Array.isArray(e.sessions) ? e.sessions : [],
    // Clamp + coerce importanceScore: a pre-v1.0.9 install may have written a
    // string (`'high'`) or out-of-range Number (`5`, `-1`) from a hand-edited
    // file. Ebbinghaus's own coerce-and-clamp handles the read-time math, but
    // the persisted value would still leak via list_memories /
    // get_related_memories / prune_memories. Normalize on restore so the value
    // surfaced from a loaded index is always a finite number in [0, 1].
    importanceScore: Math.max(0, Math.min(1, Number.isFinite(Number(e.importanceScore)) ? Number(e.importanceScore) : 0.5)),
  };
}

function loadMemIndex() {
  for (const k of Object.keys(memIndex)) delete (memIndex as any)[k];
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); } catch { return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const coerced = coerceMemEntry(v);
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
    atomicWrite(INDEX_PATH, JSON.stringify(memIndex, null, 2));
    scheduleIdfRecalc();
  }, 1000);
}

export function scheduleIdfRecalc() {
  if (idfTimer) clearTimeout(idfTimer);
  idfTimer = setTimeout(() => {
    rebuildInvertedIndex();
    atomicWrite(INVERTED_INDEX_PATH, JSON.stringify(invertedIndex, null, 2));
    buildIndexCache();
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
  saveNow();
  recalcIdfNow();
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