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
  embeddingProvider?: 'huggingface' | 'ollama' | 'vertexai';
  embeddingUrl?: string;
  embeddingModel?: string;
  embeddingApiKey?: string;
  vertexRegion?: string;
  vertexProjectId?: string;
  enableMultilingualSearch?: boolean;
}

export function loadConfig(): TotalRecallConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return {};
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