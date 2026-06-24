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

export function loadIndexes() {
  loadIndex(memIndex, INDEX_PATH);
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