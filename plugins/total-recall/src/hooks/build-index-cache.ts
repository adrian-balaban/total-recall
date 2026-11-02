import * as fs from 'fs';
import * as path from 'path';
import { PERSONAL_VAULT, ORG_VAULT, INDEX_CACHE_PATH, TOTAL_RECALL_DIR } from '../paths.js';
import { buildIndexCache } from '../index-cache.js';
import { atomicWrite } from '../atomic-write.js';

// SessionStart entry point, bundled to dist/build-index-cache.mjs and run by
// hooks/scripts/build-memory-index.sh. Exit 0 on success. On failure it exits 1, leaves
// the previous cache in place, and appends one line to ~/.total-recall/.index-cache.log
// (`<ISO time> v<version> index-cache error <message>`, last 1,000 lines kept) so a stale
// SessionStart index is visible instead of silent.

declare const __PLUGIN_VERSION__: string | undefined;
const VERSION = typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'dev';
const LOG_PATH = path.join(TOTAL_RECALL_DIR, '.index-cache.log');
const LOG_MAX_LINES = 1000;

function logFailure(message: string): void {
  const line = `${new Date().toISOString()} v${VERSION} index-cache error ${message.replace(/\s+/g, ' ')}`;
  let prior: string[] = [];
  try { prior = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean); } catch { /* first failure */ }
  atomicWrite(LOG_PATH, [...prior, line].slice(-LOG_MAX_LINES).join('\n') + '\n');
}

try {
  const { errors } = buildIndexCache(PERSONAL_VAULT, ORG_VAULT, INDEX_CACHE_PATH);
  if (errors.length > 0) {
    logFailure(errors.join(' | '));
    process.exitCode = 1;
  }
} catch (e) {
  logFailure((e as Error).message);
  process.exitCode = 1;
}
