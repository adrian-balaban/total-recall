import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatter } from './frontmatter.js';
import { atomicWrite } from './atomic-write.js';
import { listVaultFiles, keyUnder, categoryUnder, isReservedKey } from './vault-walk.js';
import { INDEX_CACHE_PATH } from './paths.js';

// The text injected at SessionStart (`.index-cache.txt`): a count line, then one line per
// memory. Its single writer is the build-index-cache bundle ([TR-W8]); the server renders
// the same text from memory for hosts that run no hooks (total-recall://index).
// May import only paths, the vault walk, frontmatter and atomic-write — never state,
// vectorStore, embeddings or persistence ([TR-S14]).

export interface CacheEntry {
  key: string;
  title: string;
  tags: string[];
  category: string;
}

export function renderIndexCache(entries: CacheEntry[]): string {
  const lines = [`${entries.length}`];
  for (const m of entries) {
    const tags = m.tags.slice(0, 3).join(', ') + (m.tags.length > 3 ? ', ...' : '');
    lines.push(`- ${m.key}: ${m.title.slice(0, 40)} [${tags}] (${m.category})`);
  }
  return lines.join('\n');
}

// One vault's entries, sorted by key so the file is stable between runs. Titles and tags
// are coerced the way reconcileIndex coerces them, so a hand-edited or teammate-pushed
// `title: 2026` or `tags: foo` cannot crash the builder or differ from list_memories.
export function readCacheEntries(
  base: string,
  isOrg: boolean,
  onError: (message: string) => void = () => {},
): CacheEntry[] {
  const out: CacheEntry[] = [];
  for (const fp of listVaultFiles(base, isOrg, onError)) {
    const key = keyUnder(base, fp, isOrg);
    if (isReservedKey(key)) continue;
    try {
      if (fs.lstatSync(fp).isSymbolicLink()) continue;
      const { data } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
      out.push({
        key,
        title: String(data.title ?? path.basename(fp, '.md')),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        category: categoryUnder(base, fp),
      });
    } catch (e) {
      // A file that vanished or became unreadable between the walk and the read is
      // skipped; the rest of the vault is still indexed.
      onError(`index-cache read ${fp}: ${(e as Error).message}`);
    }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export interface BuildResult {
  count: number;
  errors: string[];
}

// Walk both vaults, render, and write atomically. A failed write leaves the previous
// cache in place and is reported in `errors`; per-file read failures are reported too
// but do not stop the build.
export function buildIndexCache(
  personalVault: string,
  orgVault: string,
  cachePath: string = INDEX_CACHE_PATH,
): BuildResult {
  const errors: string[] = [];
  const onError = (m: string): void => { errors.push(m); };
  const entries = [
    ...readCacheEntries(personalVault, false, onError),
    ...readCacheEntries(orgVault, true, onError),
  ];
  atomicWrite(cachePath, renderIndexCache(entries) + '\n', onError);
  return { count: entries.length, errors };
}
