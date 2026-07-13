import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Paths ───────────────────────────────────────────────────────────────────

export const HOME = os.homedir();
export const TOTAL_RECALL_DIR = path.join(HOME, '.total-recall');
export const CONFIG_PATH = path.join(TOTAL_RECALL_DIR, 'config.json');

export interface TotalRecallConfig {
  personalVault?: string;
  orgVault?: string;
  orgRepo?: string;
  allowedEmailDomains?: string[];
  embeddingProvider?: 'huggingface' | 'ollama';
  embeddingUrl?: string;
  embeddingModel?: string;
  enableMultilingualSearch?: boolean;
}

// Cache the parsed config by mtime. loadConfig() is a hot path — embeddings.ts
// calls it on every embed (3 sites) and tfidf.ts on every search (the multilingual
// toggle) — so the uncached version did an existsSync + readFileSync + JSON.parse
// per call. mtimeMs (nanosecond precision on Linux/macOS) keys the cache: an edit to
// config.json changes its mtime → the next loadConfig re-reads, so a runtime toggle
// of enableMultilingualSearch / embeddingProvider / personalVault is picked up
// without a restart, exactly as before. statSync replaces the existsSync+read
// pair (one syscall on a cache hit instead of two); ENOENT (no config / cold
// start) resets the cache and returns {}. A parse error also resets, so a later
// valid write re-reads. No test toggles config in-process within a sub-second
// same-mtime window (index.test.ts writes/removes config.json once per setup,
// each advancing mtime), so the cache is test-safe.
let cachedConfig: TotalRecallConfig | null = null;
let cachedMtime = -1;

export function loadConfig(): TotalRecallConfig {
  let mtime: number;
  try {
    mtime = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    cachedConfig = null;
    cachedMtime = -1;
    return {};
  }
  if (cachedConfig !== null && mtime === cachedMtime) return cachedConfig;
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cachedConfig = parsed;
    cachedMtime = mtime;
    return parsed;
  } catch {
    cachedConfig = null;
    cachedMtime = -1;
    return {};
  }
}

const config = loadConfig();

export const PERSONAL_VAULT = config.personalVault 
  ? path.resolve(config.personalVault.replace(/^~/, HOME))
  : path.join(TOTAL_RECALL_DIR, 'personal-vault');

export const ORG_VAULT = config.orgVault
  ? path.resolve(config.orgVault.replace(/^~/, HOME))
  : path.join(TOTAL_RECALL_DIR, 'org', 'org-vault');

export const VECTORS_DB = path.join(PERSONAL_VAULT, 'vectors.db');
export const INDEX_PATH = path.join(TOTAL_RECALL_DIR, 'index.json');
export const INVERTED_INDEX_PATH = path.join(TOTAL_RECALL_DIR, 'invertedIndex.json');
export const INDEX_CACHE_PATH = path.join(TOTAL_RECALL_DIR, '.index-cache.txt');
export const RECONCILE_REQUEST_FLAG = path.join(TOTAL_RECALL_DIR, '.reconcile-requested');

export const EXCLUDED_DIRS = new Set([
  'projects', 'templates', '.obsidian', 'reference-docs', 'in-progress', 'completed',
]);
export const DEFAULT_CATEGORIES = [
  'architecture', 'decisions', 'troubleshooting', 'meetings', 'knowledge', 'journal',
];

// Opt-in immortality tag. A memory carrying this tag is:
//  - excluded from `prune_memories` candidates (query.ts), and
//  - refused by `delete_memory` unless `force=true` is passed (mutate.ts).
// Tag-only by design: the `decisions` category is NOT auto-protected, because not
// every decision is immortal — immortality is an explicit per-memory opt-in (e.g.
// an ADR you never want pruned or removed). Single-sourced here so the two tools
// agree on the literal string.
export const NO_PRUNE_TAG = 'no-prune';

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}